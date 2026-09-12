import { Injectable } from '@nestjs/common';
import type {
  CustomerCreateBody,
  CustomerDetailDto,
  CustomerDto,
  CustomerListQuery,
  CustomerPhoneCheckDto,
  CustomerPhoneCheckQuery,
  CustomerPhoneMatchDto,
  CustomerUpdateBody,
  PageDto,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { toDbMoney, toSafeMoney } from '../../common/utils/money';
import type { Customer, Prisma } from '../../generated/prisma/client';
import { lockCustomer } from '../../prisma/locks';
import { PrismaService } from '../../prisma/prisma.service';
import { pickSnapshot, toAuditSnapshot } from '../audit/audit-snapshot';
import { AuditService } from '../audit/audit.service';
import { NO_ORDERS, toCustomerDto } from './customers.mapper';
import { queryCustomerHoldings, queryCustomerPage, queryCustomerTotals } from './customers.queries';
import { runInTransaction } from '../../prisma/transaction';

const EDITABLE_FIELDS = ['name', 'phone', 'altPhone', 'address', 'creditLimit'] as const;

/** A duplicate as `CUSTOMER_PHONE_DUPLICATE` reports it: which number matched, and what it was. */
type PhoneMatch = CustomerPhoneMatchDto & { matchedValue: string };

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async list(query: CustomerListQuery): Promise<PageDto<CustomerDto>> {
    const { rows, total } = await queryCustomerPage(this.prisma, query);
    const customers = await this.prisma.customer.findMany({ where: { id: { in: rows.map((row) => row.id) } } });
    const byId = new Map(customers.map((customer) => [customer.id, customer]));

    return {
      items: rows.flatMap(({ id, ...totals }) => {
        const customer = byId.get(id);
        return customer ? [toCustomerDto(customer, totals)] : [];
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
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

  /** Archived customers are returned too: their orders still name them. */
  async get(customerId: number): Promise<CustomerDetailDto> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new ApiError('CUSTOMER_NOT_FOUND', { customerId });

    const [totals, holdings] = await Promise.all([
      queryCustomerTotals(this.prisma, [customerId]),
      queryCustomerHoldings(this.prisma, customerId),
    ]);
    return {
      ...toCustomerDto(customer, totals.get(customerId) ?? NO_ORDERS),
      holdings,
      palletsOutByItem: holdings.map((holding) => ({
        itemId: holding.item.id,
        itemName: holding.item.name,
        quantityOut: holding.quantityOut,
      })),
    };
  }

  /** A shared phone is a warning, not a block (A13): confirmed, the customer is saved. */
  async create(body: CustomerCreateBody, actor: AuthContext): Promise<CustomerDto> {
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
      return toCustomerDto(customer, NO_ORDERS);
    });
  }

  /** Lowering the credit limit below what is out is allowed: it only blocks future orders (§6.17). */
  async update(customerId: number, body: CustomerUpdateBody): Promise<CustomerDto> {
    return runInTransaction(this.prisma, async (tx) => {
      await lockCustomer(tx, customerId);
      const before = await tx.customer.findUnique({ where: { id: customerId } });
      if (!before) throw new ApiError('CUSTOMER_NOT_FOUND', { customerId });
      if (before.archivedAt) throw new ApiError('CUSTOMER_ARCHIVED', { customerId });
      if (before.version !== body.version) throw new ApiError('VERSION_CONFLICT', { currentVersion: before.version });

      const current = { ...before, creditLimit: before.creditLimit === null ? null : toSafeMoney(before.creditLimit) };
      const changed = EDITABLE_FIELDS.filter((field) => body[field] !== undefined && body[field] !== current[field]);
      // Q37: a save that changes nothing writes nothing — no version bump, no history row.
      if (changed.length === 0) return this.toDto(tx, before);

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
      return this.toDto(tx, after);
    });
  }

  /** Always an archive, and only once nothing is open: the pallets out must come back first. */
  async archive(customerId: number, version: number, actor: AuthContext): Promise<CustomerDto> {
    return runInTransaction(this.prisma, async (tx) => {
      await lockCustomer(tx, customerId);
      const before = await tx.customer.findUnique({ where: { id: customerId } });
      if (!before) throw new ApiError('CUSTOMER_NOT_FOUND', { customerId });
      if (before.archivedAt) throw new ApiError('CUSTOMER_ALREADY_ARCHIVED', { customerId });
      if (before.version !== version) throw new ApiError('VERSION_CONFLICT', { currentVersion: before.version });
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
      return this.toDto(tx, after);
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
    if (matches.length > 0) throw new ApiError('CUSTOMER_PHONE_DUPLICATE', { matches });
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

  private async toDto(client: Prisma.TransactionClient, row: Customer): Promise<CustomerDto> {
    const totals = await queryCustomerTotals(client, [row.id]);
    return toCustomerDto(row, totals.get(row.id) ?? NO_ORDERS);
  }
}
