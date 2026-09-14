import { Injectable } from '@nestjs/common';
import {
  businessToday,
  dbDateToBusiness,
  type ActivityEventDto,
  type ActivityEventKind,
  type DashboardDto,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { fromAggregate, toSafeMoney, type SqlAggregate } from '../../common/utils/money';
import { PrismaService } from '../../prisma/prisma.service';
import { uploadUrl } from '../uploads/uploads.mapper';
import { toCustomerRef } from '../customers/customers.mapper';

const RECENT = 10;
const LOW_STOCK_LISTED = 10;

/** The home page (§6.22): each section only for a viewer allowed to see it, absent otherwise (Q12). */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async get(actor: AuthContext): Promise<DashboardDto> {
    const can = (key: Parameters<AuthContext['permissions']['has']>[0]) => actor.permissions.has(key);
    const [positions, lowStock, recentActivity] = await Promise.all([
      can('reports.viewPositions') ? this.positions() : undefined,
      can('items.view') ? this.lowStock() : undefined,
      can('orders.view') ? this.recentActivity() : undefined,
    ]);
    return {
      ...(positions ? { positions } : {}),
      ...(lowStock ? { lowStock } : {}),
      ...(recentActivity ? { recentActivity } : {}),
    };
  }

  private async positions(): Promise<NonNullable<DashboardDto['positions']>> {
    const [row] = await this.prisma.$queryRaw<
      {
        pallets_out: SqlAggregate;
        out_value: SqlAggregate;
        owed: SqlAggregate;
        held: SqlAggregate;
        open_orders: SqlAggregate;
        open_customers: SqlAggregate;
      }[]
    >`
      SELECT COALESCE(SUM(out_quantity_total), 0)::bigint AS pallets_out,
             COALESCE(SUM(out_value), 0)::bigint AS out_value,
             COALESCE(SUM(owed), 0)::bigint AS owed,
             COALESCE(SUM(held), 0)::bigint AS held,
             COUNT(*) FILTER (WHERE status = 'OPEN')::bigint AS open_orders,
             COUNT(DISTINCT customer_id) FILTER (WHERE status = 'OPEN')::bigint AS open_customers
        FROM orders
       WHERE cancelled_at IS NULL`;
    return {
      palletsOut: fromAggregate(row?.pallets_out ?? 0),
      outValue: fromAggregate(row?.out_value ?? 0),
      owed: fromAggregate(row?.owed ?? 0),
      held: fromAggregate(row?.held ?? 0),
      openOrderCount: fromAggregate(row?.open_orders ?? 0),
      customersWithOpenOrders: fromAggregate(row?.open_customers ?? 0),
    };
  }

  private async lowStock(): Promise<NonNullable<DashboardDto['lowStock']>> {
    const [counted, rows] = await Promise.all([
      this.prisma.$queryRaw<{ count: SqlAggregate }[]>`
        SELECT COUNT(*)::bigint AS count FROM items
         WHERE archived_at IS NULL AND min_stock IS NOT NULL AND quantity_on_hand <= min_stock`,
      this.prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM items
         WHERE archived_at IS NULL AND min_stock IS NOT NULL AND quantity_on_hand <= min_stock
         ORDER BY quantity_on_hand - min_stock ASC, name ASC, id ASC
         LIMIT ${LOW_STOCK_LISTED}`,
    ]);
    const items = await this.prisma.item.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      include: { image: { select: { fileName: true } } },
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    return {
      count: fromAggregate(counted[0]?.count ?? 0),
      items: rows.flatMap(({ id }) => {
        const item = byId.get(id);
        return item && item.minStock !== null
          ? [
              {
                id: item.id,
                name: item.name,
                imageUrl: item.image ? uploadUrl(item.image.fileName) : null,
                quantityOnHand: item.quantityOnHand,
                minStock: item.minStock,
              },
            ]
          : [];
      }),
    };
  }

  /**
   * The latest events (§6.22): hand-overs, cancellations, returns, manual payments and refunds, newest
   * first by when they were recorded. Reversed ones stay, flagged.
   */
  private async recentActivity(): Promise<ActivityEventDto[]> {
    const keys = await this.prisma.$queryRaw<{ kind: ActivityEventKind; id: number; at: Date }[]>`
      SELECT kind, id, at FROM (
        SELECT 'HANDOVER' AS kind, o.id, o.created_at AS at FROM orders o
        UNION ALL
        SELECT 'CANCELLATION', o.id, o.cancelled_at FROM orders o WHERE o.cancelled_at IS NOT NULL
        UNION ALL
        SELECT 'RETURN', r.id, r.created_at FROM returns r
        UNION ALL
        SELECT 'PAYMENT', le.id, le.created_at FROM ledger_entries le WHERE le.type = 'PAYMENT' AND le.source = 'MANUAL'
        UNION ALL
        SELECT 'REFUND', le.id, le.created_at FROM ledger_entries le WHERE le.type = 'REFUND'
      ) events
      ORDER BY at DESC, kind ASC, id DESC
      LIMIT ${RECENT}`;
    const idsOf = (...kinds: ActivityEventKind[]): number[] =>
      keys.filter((key) => kinds.includes(key.kind)).map((key) => key.id);

    const [orders, returns, entries] = await Promise.all([
      this.prisma.order.findMany({
        where: { id: { in: idsOf('HANDOVER', 'CANCELLATION') } },
        include: { customer: true, lines: { select: { quantity: true } } },
      }),
      this.prisma.palletReturn.findMany({
        where: { id: { in: idsOf('RETURN') } },
        include: {
          order: { include: { customer: true } },
          lines: { select: { acceptedQuantity: true, damagedQuantity: true } },
        },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { id: { in: idsOf('PAYMENT', 'REFUND') } },
        include: { order: { include: { customer: true } }, reversedBy: { select: { id: true } } },
      }),
    ]);
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const returnById = new Map(returns.map((pr) => [pr.id, pr]));
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));

    return keys.flatMap(({ kind, id, at }): ActivityEventDto[] => {
      if (kind === 'HANDOVER' || kind === 'CANCELLATION') {
        const order = orderById.get(id);
        if (!order) return [];
        const handover = kind === 'HANDOVER';
        return [
          {
            kind,
            at: at.toISOString(),
            // A cancellation happens on the day it is recorded, in Baghdad.
            date: handover ? dbDateToBusiness(order.date) : businessToday(at),
            orderId: order.id,
            orderNumber: order.orderNumber,
            customer: toCustomerRef(order.customer),
            quantity: handover ? order.lines.reduce((total, line) => total + line.quantity, 0) : null,
            amount: handover ? toSafeMoney(order.depositTotal) : null,
            reversed: false,
          },
        ];
      }
      if (kind === 'RETURN') {
        const pr = returnById.get(id);
        if (!pr) return [];
        return [
          {
            kind,
            at: at.toISOString(),
            date: dbDateToBusiness(pr.date),
            orderId: pr.orderId,
            orderNumber: pr.order.orderNumber,
            customer: toCustomerRef(pr.order.customer),
            quantity: pr.lines.reduce((total, line) => total + line.acceptedQuantity + line.damagedQuantity, 0),
            amount: toSafeMoney(pr.refundDue),
            reversed: pr.reversedAt !== null,
          },
        ];
      }
      const entry = entryById.get(id);
      if (!entry) return [];
      return [
        {
          kind,
          at: at.toISOString(),
          date: dbDateToBusiness(entry.date ?? entry.order.date),
          orderId: entry.orderId,
          orderNumber: entry.order.orderNumber,
          customer: toCustomerRef(entry.order.customer),
          quantity: null,
          amount: toSafeMoney(entry.amount),
          reversed: entry.reversedBy !== null,
        },
      ];
    });
  }
}
