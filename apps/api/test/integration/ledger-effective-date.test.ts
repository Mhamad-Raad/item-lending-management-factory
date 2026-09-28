import type { INestApplication } from '@nestjs/common';
import {
  businessDateToDb,
  LEDGER_ENTRY_TYPES,
  type CustomerDto,
  type LedgerEntryListQuery,
  type LedgerEntryType,
  type OrderDetailDto,
} from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { Prisma } from '../../src/generated/prisma/client';
import { LedgerService } from '../../src/modules/ledger/ledger.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import {
  createCustomer,
  createDriver,
  createItem,
  createOrder,
  recordPayment,
  recordReturn,
} from '../helpers/factories';

const NOW = new Date('2026-09-12T09:00:00Z');

/** 2026-08-20 plus `n` days, as a business date. */
const day = (n: number): string => {
  const date = new Date(Date.UTC(2026, 7, 20 + n));
  return date.toISOString().slice(0, 10);
};

/**
 * Q98: the money ledger read as two indexable halves returns exactly what `COALESCE(le.date, o.date)`
 * over the join returned. The fixture mixes what the halves must keep apart: automatic payments (no
 * date of their own) on CASH orders, manual payments and their reversals, cash refunds and the
 * reversals a deleted return writes, and a cancelled order's rows — over three weeks, three customers.
 */
async function buildLedgerFixture(
  app: INestApplication,
  admin: Session,
): Promise<{
  customers: CustomerDto[];
  orders: OrderDetailDto[];
}> {
  const http = () => request(app.getHttpServer());
  const item = await createItem(app, admin, { name: 'Pallet', depositPrice: 1_000, stock: 5_000 });
  const driver = await createDriver(app, admin);
  const customers = [
    await createCustomer(app, admin, { name: 'Ashti', phone: '07501110001' }),
    await createCustomer(app, admin, { name: 'Baban', phone: '07501110002' }),
    await createCustomer(app, admin, { name: 'Chra', phone: '07501110003' }),
  ];
  const orders: OrderDetailDto[] = [];
  for (let i = 0; i < 18; i += 1) {
    const cash = i % 3 !== 1;
    const order = await createOrder(app, admin, {
      customerId: customers[i % 3]!.id,
      driverId: driver.id,
      date: day(i),
      paymentType: cash ? 'CASH' : 'LENT',
      lines: [{ itemId: item.id, quantity: 5 + i }],
    });
    orders.push(order);
    const line = order.lines[0]!;
    if (!cash) {
      const paymentId = await recordPayment(app, admin, {
        orderId: order.id,
        amount: 1_000 * (i + 1),
        date: day(i + 1),
      });
      if (i % 2 === 0)
        await http().post(`/api/ledger-entries/${paymentId}/reverse`).set(asUser(admin)).send({}).expect(200);
    } else if (i % 4 === 0) {
      const returnId = await recordReturn(app, admin, {
        orderId: order.id,
        date: day(i + 2),
        lines: [{ orderLineId: line.id, acceptedQuantity: 2 }],
      });
      if (i % 8 === 0) await http().delete(`/api/returns/${returnId}`).set(asUser(admin)).expect(200);
    } else if (i === 5 || i === 11) {
      await http()
        .post(`/api/orders/${order.id}/cancel`)
        .set(asUser(admin))
        .send({ version: order.version })
        .expect(200);
    }
  }
  return { customers, orders };
}

describe('the money ledger on its effective date (Q98)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let customers: CustomerDto[];
  let orders: OrderDetailDto[];

  beforeAll(async () => {
    app = await createTestApp({ clock: new FixedClock(NOW) });
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    await resetDatabase();
    const admin = await login(app);
    ({ customers, orders } = await buildLedgerFixture(app, admin));
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  /** The list's query before Q98, verbatim in its filters and order. */
  async function reference(query: LedgerEntryListQuery): Promise<{ ids: number[]; total: number }> {
    const effective = Prisma.sql`COALESCE(le.date, o.date)`;
    const conditions: Prisma.Sql[] = [];
    if (!query.includeCancelledOrders) conditions.push(Prisma.sql`o.cancelled_at IS NULL`);
    if (query.customerId) conditions.push(Prisma.sql`o.customer_id = ${query.customerId}`);
    if (query.orderId) conditions.push(Prisma.sql`le.order_id = ${query.orderId}`);
    if (query.type) conditions.push(Prisma.sql`le.type::text = ANY(${query.type}::text[])`);
    if (query.dateFrom) conditions.push(Prisma.sql`${effective} >= ${businessDateToDb(query.dateFrom)}`);
    if (query.dateTo) conditions.push(Prisma.sql`${effective} <= ${businessDateToDb(query.dateTo)}`);
    const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const column = { effectiveDate: effective, createdAt: Prisma.sql`le.created_at`, amount: Prisma.sql`le.amount` };
    const field = query.sort.replace(/^-/, '') as 'effectiveDate' | 'createdAt' | 'amount';
    const direction = query.sort.startsWith('-') ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT le.id FROM ledger_entries le JOIN orders o ON o.id = le.order_id ${where}
      ORDER BY ${column[field]} ${direction}, le.id ${direction}
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`;
    const counted = await prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM ledger_entries le JOIN orders o ON o.id = le.order_id ${where}`;
    return { ids: rows.map((row) => row.id), total: counted[0]?.total ?? 0 };
  }

  it('the fixture holds every kind of row the halves keep apart', async () => {
    const kinds = await prisma.$queryRaw<{ type: LedgerEntryType; undated: boolean; cancelled: boolean }[]>`
      SELECT DISTINCT le.type::text AS type, le.date IS NULL AS undated, o.cancelled_at IS NOT NULL AS cancelled
        FROM ledger_entries le JOIN orders o ON o.id = le.order_id`;
    expect(new Set(kinds.map((kind) => kind.type))).toEqual(new Set(LEDGER_ENTRY_TYPES));
    expect(kinds.some((kind) => kind.undated && !kind.cancelled)).toBe(true);
    expect(kinds.some((kind) => kind.undated && kind.cancelled)).toBe(true);
    expect(kinds.some((kind) => !kind.undated && kind.cancelled)).toBe(true);
  });

  it('returns the same rows, in the same order, with the same total as the COALESCE query did', async () => {
    const types: (LedgerEntryType[] | undefined)[] = [
      undefined,
      ['PAYMENT'],
      ['REFUND'],
      ['PAYMENT', 'PAYMENT_REVERSAL'],
      ['REFUND', 'REFUND_REVERSAL'],
      ['PAYMENT_REVERSAL', 'REFUND'],
    ];
    const ranges: { dateFrom?: string; dateTo?: string }[] = [
      {},
      { dateFrom: day(4) },
      { dateTo: day(9) },
      { dateFrom: day(3), dateTo: day(10) },
      { dateFrom: day(6), dateTo: day(6) },
    ];
    const scopes: Partial<LedgerEntryListQuery>[] = [
      {},
      { customerId: customers[0]!.id },
      { orderId: orders[4]!.id },
      { includeCancelledOrders: true },
      { includeCancelledOrders: true, customerId: customers[2]!.id },
    ];
    const sorts = ['-effectiveDate', 'effectiveDate', '-createdAt', 'createdAt', '-amount', 'amount'] as const;

    let compared = 0;
    for (const type of types) {
      for (const range of ranges) {
        for (const scope of scopes) {
          for (const sort of sorts) {
            const base = { includeCancelledOrders: false, ...scope, ...range, ...(type ? { type } : {}), sort };
            const all = await reference({ ...base, page: 1, pageSize: 100 });
            // Small pages too, so each half's own cut is exercised at every offset.
            for (let page = 1; page <= Math.ceil(all.total / 3) + 1; page += 1) {
              const query = { ...base, page, pageSize: 3 };
              const listed = await ledger.list(query);
              const expected = await reference(query);
              expect({ query, ids: listed.items.map((row) => row.id), total: listed.total }).toEqual({
                query,
                ...expected,
              });
              compared += 1;
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(1_000);
  });
});
