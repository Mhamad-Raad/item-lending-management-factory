import { Injectable } from '@nestjs/common';
import type {
  CustomerCreateBody,
  CustomerDetailDto,
  CustomerDto,
  CustomerHistoryItemDto,
  CustomerHistoryQuery,
  CustomerListQuery,
  CustomerPhoneCheckDto,
  CustomerPhoneCheckQuery,
  CustomerPhoneMatchDto,
  CustomerUpdateBody,
  PageDto,
  ErrorDetails,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { assertDateRange } from '../../common/utils/dates';
import { toDbMoney, toSafeMoney } from '../../common/utils/money';
import { assertVersion, changedFields } from '../../common/utils/versioning';
import { toPage } from '../../common/utils/pagination';
import type { Customer, Prisma } from '../../generated/prisma/client';
import { lockCustomer } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { pickSnapshot, toAuditSnapshot } from '../audit/audit-snapshot';
import { AuditService } from '../audit/audit.service';
import { queryCustomerHistory } from './customer-history';
import { NO_ORDERS, mayViewOrderMoney, toCustomerDto, withoutHoldingMoney } from './customers.mapper';
import { queryCustomerHoldings, queryCustomerPage, queryCustomerTotals } from './customers.queries';
import { runInTransaction } from '../../prisma/transaction';

const EDITABLE_FIELDS = ['name', 'phone', 'altPhone', 'address', 'creditLimit'] as const;
/** The list's sort keys that are sums of order money (Q72). */
const MONEY_SORTS: ReadonlySet<string> = new Set(['outValue', 'owed', 'held']);

/** A duplicate as `CUSTOMER_PHONE_DUPLICATE` reports it: which number matched, and what it was. */
type PhoneMatch = CustomerPhoneMatchDto & { matchedValue: string };

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async list(query: CustomerListQuery, actor: AuthContext): Promise<PageDto<CustomerDto>> {
    const withMoney = mayViewOrderMoney(actor);
    // Sorting by a sum would rank customers by money the caller may not see (Q72).
    if (!withMoney && MONEY_SORTS.has(query.sort.replace(/^-/, ''))) {
      throw new ApiError('PERMISSION_DENIED', { required: ['orders.view'] });
    }
    const { rows, total } = await queryCustomerPage(this.prisma, query);
    const customers = await this.prisma.customer.findMany({ where: { id: { in: rows.map((row) => row.id) } } });
    const byId = new Map(customers.map((customer) => [customer.id, customer]));

    return toPage(
      rows.flatMap(({ id, ...totals }) => {
        const customer = byId.get(id);
        return customer ? [toCustomerDto(customer, totals, withMoney)] : [];
      }),
      query,
      total,
    );
  }

  /** The form's live warning (§7.3.11): the same comparison as the one a save makes. */
  async phoneCheck(query: CustomerPhoneCheckQuery): Promise<CustomerPhoneCheckDto> {
    const matches = await this.findPhoneMatches(this.prisma, [query.phone], query.excludeId);
    return {
      normalizedPhone: query.phone,
      matches: matches.map(({ customerId, name, archived, matchedField }) => ({
        customerId,
        name,
        archived,
        matchedField,
      })),
    };
  }

  /** The customer's timeline (§6.17); a missing customer is refused rather than shown as empty. */
  async history(customerId: number, query: CustomerHistoryQuery): Promise<PageDto<CustomerHistoryItemDto>> {
    assertDateRange(query.dateFrom, query.dateTo);
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new ApiError('CUSTOMER_NOT_FOUND', { customerId });
    return queryCustomerHistory(this.prisma, customerId, query);
  }

  /** Archived customers are returned too: their orders still name them. */
  async get(customerId: number, actor: AuthContext): Promise<CustomerDetailDto> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new ApiError('CUSTOMER_NOT_FOUND', { customerId });

    const [totals, holdings] = await Promise.all([
      queryCustomerTotals(this.prisma, [customerId]),
      queryCustomerHoldings(this.prisma, customerId),
    ]);
    const withMoney = mayViewOrderMoney(actor);
    return {
      ...toCustomerDto(customer, totals.get(customerId) ?? NO_ORDERS, withMoney),
      holdings: withMoney ? holdings : holdings.map(withoutHoldingMoney),
      palletsOutByItem: holdings.map((holding) => ({
        itemId: holding.item.id,
        itemName: holding.item.name,
        quantityOut: holding.quantityOut,
      })),
    };
  }

  /**
   * A shared phone is a warning, not a block (A13): confirmed, the customer is saved. Only an admin
   * may give a new customer a credit limit (Q71); anyone else creates it without one.
   */
  async create(body: CustomerCreateBody, actor: AuthContext): Promise<CustomerDto> {
    if (body.creditLimit !== null) assertMaySetCreditLimit(actor);
    if (!body.confirmDuplicatePhone) await this.assertNoDuplicates(this.prisma, [body.phone, body.altPhone]);

    return runInTransaction(this.prisma, async (tx) => {
      const customer = await tx.customer.create({
        data: {
          name: body.name,
          phone: body.phone,
          altPhone: body.altPhone,
          address: body.address,
          creditLimit: body.creditLimit === null ? null : toDbMoney(body.creditLimit),
          createdByUserId: actor.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'CREATE',
        entityType: 'CUSTOMER',
        entityId: String(customer.id),
        summaryParams: { name: customer.name },
        after: toAuditSnapshot('CUSTOMER', customer),
      });
      return toCustomerDto(customer, NO_ORDERS, mayViewOrderMoney(actor));
    });
  }

  /**
   * Lowering the credit limit below what is out is allowed: it only blocks future orders (§6.17).
   * Changing it at all is an admin's decision (Q71); a form that sends the limit unchanged is fine.
   */
  async update(customerId: number, body: CustomerUpdateBody, actor: AuthContext): Promise<CustomerDto> {
    return runInTransaction(this.prisma, async (tx) => {
      await lockCustomer(tx, customerId);
      const before = await tx.customer.findUnique({ where: { id: customerId } });
      if (!before) throw new ApiError('CUSTOMER_NOT_FOUND', { customerId });
      if (before.archivedAt) throw new ApiError('CUSTOMER_ARCHIVED', { customerId });
      assertVersion(before.version, body.version);

      const current = { ...before, creditLimit: before.creditLimit === null ? null : toSafeMoney(before.creditLimit) };
      const changed = changedFields(body, current, EDITABLE_FIELDS);
      // Q37: a save that changes nothing writes nothing — no version bump, no history row.
      if (changed.length === 0) return this.toDto(tx, before, actor);
      if (changed.includes('creditLimit')) assertMaySetCreditLimit(actor);

      const phone = body.phone ?? before.phone;
      const altPhone = body.altPhone === undefined ? before.altPhone : body.altPhone;
      if (altPhone === phone) {
        throw new ApiError('VALIDATION_FAILED', undefined, [
          { path: body.altPhone === undefined ? 'phone' : 'altPhone', code: 'duplicate' },
        ]);
      }
      // Only a number that changes is checked: one already on file was warned about when it was saved.
      if (!body.confirmDuplicatePhone) {
        await this.assertNoDuplicates(
          tx,
          [changed.includes('phone') ? phone : null, changed.includes('altPhone') ? altPhone : null],
          customerId,
        );
      }

      const after = await tx.customer.update({
        where: { id: customerId },
        data: {
          name: body.name,
          phone: body.phone,
          altPhone: body.altPhone,
          address: body.address,
          creditLimit:
            body.creditLimit === undefined ? undefined : body.creditLimit === null ? null : toDbMoney(body.creditLimit),
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entityType: 'CUSTOMER',
        entityId: String(customerId),
        summaryParams: { name: after.name, fields: changed },
        before: pickSnapshot(toAuditSnapshot('CUSTOMER', before), changed),
        after: pickSnapshot(toAuditSnapshot('CUSTOMER', after), changed),
      });
      return this.toDto(tx, after, actor);
    });
  }

  /** Always an archive, and only once nothing is open: the pallets out must come back first. */
  async archive(customerId: number, version: number, actor: AuthContext): Promise<CustomerDto> {
    return runInTransaction(this.prisma, async (tx) => {
      await lockCustomer(tx, customerId);
      const before = await tx.customer.findUnique({ where: { id: customerId } });
      if (!before) throw new ApiError('CUSTOMER_NOT_FOUND', { customerId });
      if (before.archivedAt) throw new ApiError('CUSTOMER_ALREADY_ARCHIVED', { customerId });
      assertVersion(before.version, version);
      const openOrderCount = await tx.order.count({ where: { customerId, status: 'OPEN' } });
      if (openOrderCount > 0) throw new ApiError('CUSTOMER_HAS_OPEN_ORDERS', { openOrderCount });

      const after = await tx.customer.update({
        where: { id: customerId },
        data: { archivedAt: this.clock.now(), archivedByUserId: actor.userId, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'DELETE',
        entityType: 'CUSTOMER',
        entityId: String(customerId),
        summaryParams: { name: after.name },
        before: toAuditSnapshot('CUSTOMER', before),
        after: toAuditSnapshot('CUSTOMER', after),
      });
      return this.toDto(tx, after, actor);
    });
  }

  private async assertNoDuplicates(
    client: Prisma.TransactionClient,
    phones: readonly (string | null)[],
    excludeId?: number,
  ): Promise<void> {
    const wanted = phones.filter((phone): phone is string => phone !== null);
    if (wanted.length === 0) return;
    const matches = await this.findPhoneMatches(client, wanted, excludeId);
    if (matches.length > 0)
      throw new ApiError('CUSTOMER_PHONE_DUPLICATE', { matches } satisfies ErrorDetails<'CUSTOMER_PHONE_DUPLICATE'>);
  }

  /** Every other customer, archived ones included, holding one of `phones` as either number (Q13). */
  private async findPhoneMatches(
    client: Prisma.TransactionClient,
    phones: readonly string[],
    excludeId?: number,
  ): Promise<PhoneMatch[]> {
    const rows = await client.customer.findMany({
      where: {
        ...(excludeId === undefined ? {} : { id: { not: excludeId } }),
        OR: [{ phone: { in: [...phones] } }, { altPhone: { in: [...phones] } }],
      },
      select: { id: true, name: true, archivedAt: true, phone: true, altPhone: true },
      orderBy: { id: 'asc' },
    });

    return rows.flatMap((row) => {
      const match = { customerId: row.id, name: row.name, archived: row.archivedAt !== null };
      return [
        ...(phones.includes(row.phone) ? [{ ...match, matchedField: 'phone' as const, matchedValue: row.phone }] : []),
        ...(row.altPhone !== null && phones.includes(row.altPhone)
          ? [{ ...match, matchedField: 'altPhone' as const, matchedValue: row.altPhone }]
          : []),
      ];
    });
  }

  private async toDto(client: Prisma.TransactionClient, row: Customer, actor: AuthContext): Promise<CustomerDto> {
    const totals = await queryCustomerTotals(client, [row.id]);
    return toCustomerDto(row, totals.get(row.id) ?? NO_ORDERS, mayViewOrderMoney(actor));
  }
}

/**
 * The credit limit is what the admin-only override (§4.4) protects: whoever may set it may lift it,
 * so setting it is admin-only too (Q71).
 */
function assertMaySetCreditLimit(actor: AuthContext): void {
  if (!actor.isAdmin) throw new ApiError('CUSTOMER_CREDIT_LIMIT_ADMIN_ONLY');
}
