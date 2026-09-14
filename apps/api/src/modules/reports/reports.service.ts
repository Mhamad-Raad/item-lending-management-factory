import { Injectable } from '@nestjs/common';
import {
  businessDateToDb,
  dbDateToBusiness,
  type ActivityReportDto,
  type ActivityReportQuery,
  type ItemRefDto,
  type PositionsReportDto,
  type PositionsReportQuery,
  type PurchasesReportDto,
  type PurchasesReportQuery,
  type StockReportDto,
  type StockReportQuery,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { assertDateRange, assertNotInFuture } from '../../common/utils/dates';
import { fromAggregate, toSafeMoney, type SqlAggregate } from '../../common/utils/money';
import { parseSort } from '../../common/utils/sort';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toCustomerRef } from '../customers/customers.mapper';
import { toDriverRef } from '../drivers/drivers.mapper';
import { ITEM_REF_INCLUDE, toItemRef } from '../items/items.mapper';
import { LEDGER_ENTRY_INCLUDE, toLedgerEntryDto } from '../ledger/ledger.mapper';

/** §12.1: each row array stops at 5,000; asking for one more tells whether it was cut. */
export const ROW_CAP = 5_000;

/**
 * The four reports (§6.23, §12). Every aggregate is SQL over the stored order cache and ledger rows,
 * leaving out cancelled orders, reversed returns and deleted batches; rows are then hydrated in
 * batched reads for their names. Response shapes are §6.9's (Q42).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /**
   * A report reads in several queries — keys, totals, then the rows' names — and they must all see one
   * moment, or a return recorded in between would appear in the rows but not the totals. Read-only
   * work, so REPEATABLE READ is safe here; §4.8's "never SERIALIZABLE" concerns the writes.
   */
  private snapshot<T>(read: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(read, { isolationLevel: 'RepeatableRead', maxWait: 5_000, timeout: 30_000 });
  }

  positions(query: PositionsReportQuery): Promise<PositionsReportDto> {
    return this.snapshot(async (db) => {
      const customerFilter = query.customerId ? Prisma.sql`AND c.id = ${query.customerId}` : Prisma.empty;
      const zeroFilter = query.includeZero
        ? Prisma.empty
        : Prisma.sql`AND (COALESCE(pc.pallets_out, 0) > 0 OR COALESCE(pc.owed, 0) > 0 OR COALESCE(pc.held, 0) > 0)`;
      const rows = await db.$queryRaw<
        { id: number; pallets_out: SqlAggregate; out_value: SqlAggregate; owed: SqlAggregate; held: SqlAggregate }[]
      >`
        WITH per_customer AS (
          SELECT o.customer_id,
                 SUM(o.out_quantity_total)::bigint AS pallets_out,
                 SUM(o.out_value)::bigint AS out_value,
                 SUM(o.owed)::bigint AS owed,
                 SUM(o.held)::bigint AS held
            FROM orders o
           WHERE o.cancelled_at IS NULL
           GROUP BY o.customer_id
        )
        SELECT c.id, pc.pallets_out, pc.out_value, pc.owed, pc.held
          FROM customers c
          LEFT JOIN per_customer pc ON pc.customer_id = c.id
         WHERE TRUE ${customerFilter} ${zeroFilter}
         ORDER BY c.id`;
      const ids = rows.map((row) => row.id);
      const perItem = ids.length
        ? await db.$queryRaw<{ customer_id: number; item_id: number; quantity: SqlAggregate }[]>`
            SELECT o.customer_id, ol.item_id, SUM(ol.out_quantity)::bigint AS quantity
              FROM order_lines ol JOIN orders o ON o.id = ol.order_id
             WHERE o.cancelled_at IS NULL AND ol.out_quantity > 0 AND o.customer_id = ANY(${ids}::int[])
             GROUP BY o.customer_id, ol.item_id`
        : [];

      const [customers, items] = await Promise.all([
        db.customer.findMany({ where: { id: { in: ids } } }),
        db.item.findMany({
          where: { id: { in: [...new Set(perItem.map((row) => row.item_id))] } },
          ...ITEM_REF_INCLUDE,
        }),
      ]);
      const columns = items.map(toItemRef).sort(byName);
      const customerById = new Map(customers.map((customer) => [customer.id, customer]));
      // Keyed once: a lookup per customer × item column stays constant-time on a large customer list.
      const perItemQuantity = new Map(
        perItem.map((row) => [`${row.customer_id}:${row.item_id}`, fromAggregate(row.quantity)]),
      );
      const quantityOf = (customerId: number, itemId: number): number =>
        perItemQuantity.get(`${customerId}:${itemId}`) ?? 0;

      const result = rows.flatMap((row) => {
        const customer = customerById.get(row.id);
        if (!customer) return [];
        return [
          {
            customer: toCustomerRef(customer),
            palletsOutByItem: columns.map((item) => ({ itemId: item.id, quantityOut: quantityOf(row.id, item.id) })),
            palletsOut: fromAggregate(row.pallets_out),
            outValue: fromAggregate(row.out_value),
            owed: fromAggregate(row.owed),
            held: fromAggregate(row.held),
          },
        ];
      });
      const { field, direction } = parseSort<'customerName' | 'palletsOut' | 'outValue' | 'owed' | 'held'>(query.sort);
      const sign = direction === 'asc' ? 1 : -1;
      // A snapshot of one row per customer: ordered in memory, the name breaking every tie.
      result.sort((x, y) => {
        const primary = field === 'customerName' ? x.customer.name.localeCompare(y.customer.name) : x[field] - y[field];
        return primary * sign || x.customer.name.localeCompare(y.customer.name) || x.customer.id - y.customer.id;
      });

      const sum = (pick: (row: (typeof result)[number]) => number): number =>
        result.reduce((total, row) => total + pick(row), 0);
      return {
        generatedAt: this.clock.now().toISOString(),
        columns,
        rows: result,
        totals: {
          palletsOutByItem: columns.map((item) => ({
            itemId: item.id,
            quantityOut: sum((row) => row.palletsOutByItem.find((cell) => cell.itemId === item.id)?.quantityOut ?? 0),
          })),
          palletsOut: sum((row) => row.palletsOut),
          outValue: sum((row) => row.outValue),
          owed: sum((row) => row.owed),
          held: sum((row) => row.held),
        },
      };
    });
  }

  purchases(query: PurchasesReportQuery, actor: AuthContext): Promise<PurchasesReportDto> {
    return this.snapshot(async (db) => {
      // The route's permission implies cost access today; this holds even if that dependency changes (§6.23).
      if (!actor.canViewCost) throw new ApiError('PERMISSION_DENIED', { required: ['items.viewCost'] });
      this.assertPeriod(query.dateFrom, query.dateTo);
      const where = Prisma.sql`
        pb.deleted_at IS NULL
        AND pb.date BETWEEN ${businessDateToDb(query.dateFrom)}::date AND ${businessDateToDb(query.dateTo)}::date
        ${query.itemId ? Prisma.sql`AND pb.item_id = ${query.itemId}` : Prisma.empty}`;

      const [batches, perItem] = await Promise.all([
        db.$queryRaw<{ id: number }[]>`
          SELECT pb.id FROM purchase_batches pb WHERE ${where} ORDER BY pb.date ASC, pb.id ASC LIMIT ${ROW_CAP + 1}`,
        db.$queryRaw<
          { item_id: number; batch_count: SqlAggregate; quantity: SqlAggregate; total_cost: SqlAggregate }[]
        >`
          SELECT pb.item_id, COUNT(*)::bigint AS batch_count, SUM(pb.quantity)::bigint AS quantity,
                 SUM(pb.total_cost)::bigint AS total_cost
            FROM purchase_batches pb WHERE ${where} GROUP BY pb.item_id`,
      ]);
      const page = batches.slice(0, ROW_CAP).map((row) => row.id);
      const stored = await db.purchaseBatch.findMany({
        where: { id: { in: page } },
        include: { item: ITEM_REF_INCLUDE },
      });
      const byId = new Map(stored.map((batch) => [batch.id, batch]));
      const items = new Map(
        (await db.item.findMany({ where: { id: { in: perItem.map((row) => row.item_id) } }, ...ITEM_REF_INCLUDE })).map(
          (item) => [item.id, toItemRef(item)],
        ),
      );

      const perItemRows = perItem
        .flatMap((row) => {
          const item = items.get(row.item_id);
          return item
            ? [
                {
                  item,
                  batchCount: fromAggregate(row.batch_count),
                  quantity: fromAggregate(row.quantity),
                  totalCost: fromAggregate(row.total_cost),
                },
              ]
            : [];
        })
        .sort((x, y) => byName(x.item, y.item));
      return {
        generatedAt: this.clock.now().toISOString(),
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        rows: page.flatMap((id) => {
          const batch = byId.get(id);
          return batch
            ? [
                {
                  batchId: batch.id,
                  item: toItemRef(batch.item),
                  date: dbDateToBusiness(batch.date),
                  quantity: batch.quantity,
                  unitCost: toSafeMoney(batch.unitCost),
                  totalCost: toSafeMoney(batch.totalCost),
                  note: batch.note,
                },
              ]
            : [];
        }),
        perItem: perItemRows,
        totals: {
          batchCount: perItemRows.reduce((total, row) => total + row.batchCount, 0),
          quantity: perItemRows.reduce((total, row) => total + row.quantity, 0),
          totalCost: perItemRows.reduce((total, row) => total + row.totalCost, 0),
        },
        truncated: batches.length > ROW_CAP,
      };
    });
  }

  activity(query: ActivityReportQuery): Promise<ActivityReportDto> {
    return this.snapshot(async (db) => {
      this.assertPeriod(query.dateFrom, query.dateTo);
      const from = businessDateToDb(query.dateFrom);
      const to = businessDateToDb(query.dateTo);
      const moneyOmitted = query.itemId !== undefined;
      // F(o) of §12.4: live orders, through the order's customer and driver.
      const orderFilter = Prisma.sql`
        o.cancelled_at IS NULL
        ${query.customerId ? Prisma.sql`AND o.customer_id = ${query.customerId}` : Prisma.empty}
        ${query.driverId ? Prisma.sql`AND o.driver_id = ${query.driverId}` : Prisma.empty}`;
      const lineFilter = query.itemId ? Prisma.sql`AND ol.item_id = ${query.itemId}` : Prisma.empty;
      const itemIdFilter = query.itemId === undefined ? {} : { itemId: query.itemId };

      const [handoverKeys, handoverTotals, returnKeys, returnTotals, compensationRows] = await Promise.all([
        db.$queryRaw<{ id: number }[]>`
          SELECT o.id FROM orders o
           WHERE ${orderFilter} AND o.date BETWEEN ${from}::date AND ${to}::date
             AND EXISTS (SELECT 1 FROM order_lines ol WHERE ol.order_id = o.id ${lineFilter})
           ORDER BY o.date ASC, o.created_at ASC, o.id ASC LIMIT ${ROW_CAP + 1}`,
        db.$queryRaw<{ quantity: SqlAggregate; deposit: SqlAggregate }[]>`
          SELECT SUM(ol.quantity)::bigint AS quantity, SUM(ol.line_total)::bigint AS deposit
            FROM order_lines ol JOIN orders o ON o.id = ol.order_id
           WHERE ${orderFilter} AND o.date BETWEEN ${from}::date AND ${to}::date ${lineFilter}`,
        db.$queryRaw<{ id: number }[]>`
          SELECT r.id FROM returns r JOIN orders o ON o.id = r.order_id
           WHERE ${orderFilter} AND r.reversed_at IS NULL AND r.date BETWEEN ${from}::date AND ${to}::date
             AND EXISTS (SELECT 1 FROM return_lines rl JOIN order_lines ol ON ol.id = rl.order_line_id
                          WHERE rl.return_id = r.id ${lineFilter})
           ORDER BY r.date ASC, r.created_at ASC, r.id ASC LIMIT ${ROW_CAP + 1}`,
        db.$queryRaw<
          { accepted: SqlAggregate; damaged: SqlAggregate; refund_due: SqlAggregate; compensation: SqlAggregate }[]
        >`
          SELECT SUM(rl.accepted_quantity)::bigint AS accepted, SUM(rl.damaged_quantity)::bigint AS damaged,
                 SUM(rl.accepted_quantity * rl.unit_deposit + rl.damaged_refund)::bigint AS refund_due,
                 SUM(rl.damaged_quantity * rl.unit_deposit - rl.damaged_refund)::bigint AS compensation
            FROM return_lines rl
            JOIN returns r ON r.id = rl.return_id AND r.reversed_at IS NULL
            JOIN order_lines ol ON ol.id = rl.order_line_id
            JOIN orders o ON o.id = r.order_id
           WHERE ${orderFilter} AND r.date BETWEEN ${from}::date AND ${to}::date ${lineFilter}`,
        db.$queryRaw<{ id: number }[]>`
          SELECT rl.id FROM return_lines rl
            JOIN returns r ON r.id = rl.return_id AND r.reversed_at IS NULL
            JOIN order_lines ol ON ol.id = rl.order_line_id
            JOIN orders o ON o.id = r.order_id
           WHERE ${orderFilter} AND r.date BETWEEN ${from}::date AND ${to}::date AND rl.damaged_quantity > 0 ${lineFilter}
           ORDER BY r.date ASC, r.created_at ASC, rl.id ASC LIMIT ${ROW_CAP + 1}`,
      ]);

      const money = moneyOmitted
        ? null
        : await Promise.all(
            (['PAYMENT', 'REFUND'] as const).map(async (kind) => {
              const types = kind === 'PAYMENT' ? ['PAYMENT', 'PAYMENT_REVERSAL'] : ['REFUND', 'REFUND_REVERSAL'];
              const moneyWhere = Prisma.sql`
                ${orderFilter} AND le.type::text = ANY(${types}::text[])
                AND COALESCE(le.date, o.date) BETWEEN ${from}::date AND ${to}::date`;
              const [keys, totals] = await Promise.all([
                db.$queryRaw<{ id: number }[]>`
                  SELECT le.id FROM ledger_entries le JOIN orders o ON o.id = le.order_id
                   WHERE ${moneyWhere}
                   ORDER BY COALESCE(le.date, o.date) ASC, le.created_at ASC, le.id ASC LIMIT ${ROW_CAP + 1}`,
                db.$queryRaw<{ gross: SqlAggregate; reversals: SqlAggregate }[]>`
                  SELECT COALESCE(SUM(le.amount) FILTER (WHERE le.type::text = ${kind}), 0)::bigint AS gross,
                         COALESCE(SUM(le.amount) FILTER (WHERE le.type::text <> ${kind}), 0)::bigint AS reversals
                    FROM ledger_entries le JOIN orders o ON o.id = le.order_id
                   WHERE ${moneyWhere}`,
              ]);
              return {
                keys,
                gross: fromAggregate(totals[0]?.gross ?? 0),
                reversals: fromAggregate(totals[0]?.reversals ?? 0),
              };
            }),
          );

      const cap = (keys: { id: number }[]) => keys.slice(0, ROW_CAP).map((row) => row.id);
      const [handovers, returns, compensation, ledger] = await Promise.all([
        db.order.findMany({
          where: { id: { in: cap(handoverKeys) } },
          include: {
            customer: true,
            driver: true,
            lines: { where: itemIdFilter, orderBy: { id: 'asc' }, include: { item: ITEM_REF_INCLUDE } },
          },
        }),
        db.palletReturn.findMany({
          where: { id: { in: cap(returnKeys) } },
          include: {
            order: { include: { customer: true } },
            lines: {
              where: query.itemId ? { orderLine: itemIdFilter } : {},
              orderBy: { id: 'asc' },
              include: { orderLine: { include: { item: ITEM_REF_INCLUDE } } },
            },
          },
        }),
        db.returnLine.findMany({
          where: { id: { in: cap(compensationRows) } },
          include: {
            return: { include: { order: { include: { customer: true } } } },
            orderLine: { include: { item: ITEM_REF_INCLUDE } },
          },
        }),
        money
          ? db.ledgerEntry.findMany({
              where: { id: { in: [...cap(money[0]?.keys ?? []), ...cap(money[1]?.keys ?? [])] } },
              include: { ...LEDGER_ENTRY_INCLUDE, order: { include: { customer: true } } },
            })
          : Promise.resolve([]),
      ]);
      const inOrder = <T extends { id: number }>(keys: { id: number }[], found: T[]): T[] => {
        const byId = new Map(found.map((row) => [row.id, row]));
        return cap(keys).flatMap((id) => {
          const row = byId.get(id);
          return row ? [row] : [];
        });
      };
      const ledgerDto = (keys: { id: number }[]) =>
        inOrder(keys, ledger).map((entry) => toLedgerEntryDto(entry, entry.order));
      const payments = money?.[0];
      const refunds = money?.[1];
      const handoverTotal = handoverTotals[0];
      const returnTotal = returnTotals[0];

      return {
        generatedAt: this.clock.now().toISOString(),
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        filters: {
          customerId: query.customerId ?? null,
          itemId: query.itemId ?? null,
          driverId: query.driverId ?? null,
        },
        moneyOmitted,
        handovers: inOrder(handoverKeys, handovers).map((order) => {
          const lines = order.lines.map((line) => ({
            item: toItemRef(line.item),
            quantity: line.quantity,
            unitDeposit: toSafeMoney(line.unitDeposit),
            lineTotal: toSafeMoney(line.lineTotal),
          }));
          return {
            orderId: order.id,
            orderNumber: order.orderNumber,
            date: dbDateToBusiness(order.date),
            customer: toCustomerRef(order.customer),
            driver: toDriverRef(order.driver),
            paymentType: order.paymentType,
            lines,
            quantity: lines.reduce((total, line) => total + line.quantity, 0),
            depositTotal: lines.reduce((total, line) => total + line.lineTotal, 0),
          };
        }),
        returns: inOrder(returnKeys, returns).map((pr) => {
          const lines = pr.lines.map((line) => {
            const unitDeposit = toSafeMoney(line.unitDeposit);
            const damagedRefund = toSafeMoney(line.damagedRefund);
            return {
              item: toItemRef(line.orderLine.item),
              acceptedQuantity: line.acceptedQuantity,
              damagedQuantity: line.damagedQuantity,
              damagedRefund,
              compensation: line.damagedQuantity * unitDeposit - damagedRefund,
              credit: line.acceptedQuantity * unitDeposit + damagedRefund,
            };
          });
          return {
            returnId: pr.id,
            orderId: pr.orderId,
            orderNumber: pr.order.orderNumber,
            date: dbDateToBusiness(pr.date),
            customer: toCustomerRef(pr.order.customer),
            lines: lines.map(({ credit: _credit, ...line }) => line),
            acceptedQuantity: lines.reduce((total, line) => total + line.acceptedQuantity, 0),
            damagedQuantity: lines.reduce((total, line) => total + line.damagedQuantity, 0),
            // Over the lines shown: with an item filter, the credit that item's lines gave.
            refundDue: lines.reduce((total, line) => total + line.credit, 0),
            // Cash is paid per return, not per item: with an item filter it is not the item's to show.
            cashRefund: query.itemId === undefined ? toSafeMoney(pr.cashRefund) : 0,
          };
        }),
        payments: payments ? ledgerDto(payments.keys) : [],
        refunds: refunds ? ledgerDto(refunds.keys) : [],
        compensation: inOrder(compensationRows, compensation).map((line) => {
          const unitDeposit = toSafeMoney(line.unitDeposit);
          const damagedRefund = toSafeMoney(line.damagedRefund);
          return {
            returnId: line.returnId,
            orderNumber: line.return.order.orderNumber,
            date: dbDateToBusiness(line.return.date),
            customer: toCustomerRef(line.return.order.customer),
            item: toItemRef(line.orderLine.item),
            damagedQuantity: line.damagedQuantity,
            unitDeposit,
            damagedRefund,
            compensation: line.damagedQuantity * unitDeposit - damagedRefund,
          };
        }),
        totals: {
          handoverQuantity: fromAggregate(handoverTotal?.quantity ?? 0),
          handoverDepositTotal: fromAggregate(handoverTotal?.deposit ?? 0),
          returnedAccepted: fromAggregate(returnTotal?.accepted ?? 0),
          returnedDamaged: fromAggregate(returnTotal?.damaged ?? 0),
          refundDueTotal: fromAggregate(returnTotal?.refund_due ?? 0),
          paymentsGross: payments?.gross ?? 0,
          paymentReversals: payments?.reversals ?? 0,
          paymentsNet: (payments?.gross ?? 0) - (payments?.reversals ?? 0),
          refundsGross: refunds?.gross ?? 0,
          refundReversals: refunds?.reversals ?? 0,
          refundsNet: (refunds?.gross ?? 0) - (refunds?.reversals ?? 0),
          compensationAssessed: fromAggregate(returnTotal?.compensation ?? 0),
        },
        truncated: [handoverKeys, returnKeys, compensationRows, ...(money ?? []).map((section) => section.keys)].some(
          (keys) => keys.length > ROW_CAP,
        ),
      };
    });
  }

  stock(query: StockReportQuery): Promise<StockReportDto> {
    return this.snapshot(async (db) => {
      const archived = query.includeArchived ? Prisma.empty : Prisma.sql`AND i.archived_at IS NULL`;
      const lowOnly = query.lowStockOnly
        ? Prisma.sql`AND i.archived_at IS NULL AND i.min_stock IS NOT NULL AND i.quantity_on_hand <= i.min_stock`
        : Prisma.empty;
      const rows = await db.$queryRaw<{ id: number; quantity_out: SqlAggregate; damaged_total: SqlAggregate }[]>`
        WITH out_q AS (
          SELECT ol.item_id, SUM(ol.out_quantity)::bigint AS q
            FROM order_lines ol JOIN orders o ON o.id = ol.order_id
           WHERE o.cancelled_at IS NULL
           GROUP BY ol.item_id
        ), damaged_q AS (
          SELECT ol.item_id, SUM(rl.damaged_quantity)::bigint AS q
            FROM return_lines rl
            JOIN returns r ON r.id = rl.return_id AND r.reversed_at IS NULL
            JOIN order_lines ol ON ol.id = rl.order_line_id
            JOIN orders o ON o.id = ol.order_id AND o.cancelled_at IS NULL
           GROUP BY ol.item_id
        )
        SELECT i.id, COALESCE(out_q.q, 0) AS quantity_out, COALESCE(damaged_q.q, 0) AS damaged_total
          FROM items i
          LEFT JOIN out_q ON out_q.item_id = i.id
          LEFT JOIN damaged_q ON damaged_q.item_id = i.id
         WHERE TRUE ${archived} ${lowOnly}`;
      const items = new Map(
        (await db.item.findMany({ where: { id: { in: rows.map((row) => row.id) } }, ...ITEM_REF_INCLUDE })).map(
          (item) => [item.id, item],
        ),
      );
      const result = rows.flatMap((row) => {
        const item = items.get(row.id);
        if (!item) return [];
        return [
          {
            item: toItemRef(item),
            quantityOnHand: item.quantityOnHand,
            quantityOut: fromAggregate(row.quantity_out),
            damagedTotal: fromAggregate(row.damaged_total),
            minStock: item.minStock,
            // An archived item is no longer restocked, so it is never low (§12.5).
            isLowStock: item.archivedAt === null && item.minStock !== null && item.quantityOnHand <= item.minStock,
          },
        ];
      });
      const { field, direction } = parseSort<'name' | 'quantityOnHand' | 'quantityOut' | 'damagedTotal'>(query.sort);
      const sign = direction === 'asc' ? 1 : -1;
      result.sort((x, y) => {
        const primary = field === 'name' ? x.item.name.localeCompare(y.item.name) : x[field] - y[field];
        return primary * sign || x.item.name.localeCompare(y.item.name) || x.item.id - y.item.id;
      });
      const sum = (pick: (row: (typeof result)[number]) => number): number =>
        result.reduce((total, row) => total + pick(row), 0);
      return {
        generatedAt: this.clock.now().toISOString(),
        rows: result,
        totals: {
          quantityOnHand: sum((row) => row.quantityOnHand),
          quantityOut: sum((row) => row.quantityOut),
          damagedTotal: sum((row) => row.damagedTotal),
          lowStockCount: result.filter((row) => row.isLowStock).length,
        },
      };
    });
  }

  /** §12.1: an inclusive business-date period, the right way round and not reaching past today. */
  private assertPeriod(dateFrom: string, dateTo: string): void {
    assertDateRange(dateFrom, dateTo);
    assertNotInFuture(this.clock, dateFrom, 'dateFrom');
    assertNotInFuture(this.clock, dateTo, 'dateTo');
  }
}

function byName(x: ItemRefDto, y: ItemRefDto): number {
  return x.name.localeCompare(y.name) || x.id - y.id;
}
