/**
 * `pnpm db:seed:demo` — development only (§9): two months of believable activity for a pallet factory in
 * Erbil, kept small enough to read through — ten items, customers and drivers, and about ten orders with their
 * returns and payments — recorded through the domain services, so stock, ledgers, order totals and the history are exactly
 * what the app itself would have written. The services' clock is walked forward day by day, which dates the
 * business dates and the timestamps the services set (cancellations, reversals, overrides, archiving); the
 * `created_at` columns the database fills with now() are moved to the same times afterwards (`backdate`).
 * Deterministic: the same seed and the same end date give the same data. Refuses to run in production or on a
 * database that already holds items, customers or orders. Stop the API first: rows anything else writes while
 * it runs would be dated with the seed's, and the dating step locks the ledger tables until it commits.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import {
  CustomerCreateBody,
  DriverCreateBody,
  ItemCreateBody,
  LedgerEntryReverseBody,
  OrderCreateBody,
  PaymentCreateBody,
  PERMISSION_KEYS,
  PurchaseBatchCreateBody,
  ReturnCreateBody,
  SettingsUpdateBody,
  StockAdjustmentCreateBody,
  businessDayStartUtc,
  businessToday,
  type OrderDetailDto,
} from '@pallet/shared';
import { AppModule } from '../app.module';
import type { AuthContext } from '../common/auth-context';
import { Clock } from '../common/clock';
import { RequestContext } from '../common/context/request-context';
import { ApiError } from '../common/errors/api-error';
import { Prisma, type IdempotencyScope, type PrismaClient } from '../generated/prisma/client';
import { CustomersService } from '../modules/customers/customers.service';
import { DriversService } from '../modules/drivers/drivers.service';
import { IdempotencyService, type IdempotentRequest } from '../modules/idempotency/idempotency.service';
import { ItemsService } from '../modules/items/items.service';
import { PaymentsService } from '../modules/ledger/payments.service';
import { OrderChangesService } from '../modules/orders/order-changes.service';
import { OrdersService } from '../modules/orders/orders.service';
import { PurchasesService } from '../modules/purchases/purchases.service';
import { ReturnsService } from '../modules/returns/returns.service';
import { SettingsService } from '../modules/settings/settings.service';
import { createPrismaClient } from '../prisma/create-client';
import { PrismaService } from '../prisma/prisma.service';
import { findLedgerDiscrepancies } from '../prisma/reconciliation';

const SEED = 20260911;
const DAYS = 62;
/** The days an order goes out on, one each: ten orders spread over the two months, the last ones still out. */
const ORDER_DAYS = [0, 6, 12, 19, 25, 32, 38, 45, 51, 57] as const;
/** Which order the customer calls off the same morning (its index in `ORDER_DAYS`). */
const CANCELLED_ORDER = 6;
const MINUTE = 60_000;

/** mulberry32, as in the I14 sequence test: small, deterministic, good enough for demo data. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = generator(SEED);
const between = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));
const chance = (probability: number): boolean => random() < probability;
const roundTo = (value: number, step: number): number => Math.max(step, Math.round(value / step) * step);

function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** Friday is the weekend in Iraq: the yard is closed. */
const isFriday = (date: string): boolean => new Date(`${date}T00:00:00.000Z`).getUTCDay() === 5;

const ITEMS = [
  { name: 'پالێتی یۆرۆ 120×80', depositPrice: 12_000, minStock: 100, stock: 700, unitCost: 8_500, order: [20, 160] },
  {
    name: 'پالێتی ستاندارد 120×100',
    depositPrice: 15_000,
    minStock: 80,
    stock: 500,
    unitCost: 10_500,
    order: [20, 120],
  },
  { name: 'پالێتی قورس 120×120', depositPrice: 22_000, minStock: 40, stock: 220, unitCost: 16_000, order: [10, 60] },
  { name: 'نیوە پالێت 80×60', depositPrice: 7_000, minStock: 50, stock: 350, unitCost: 4_500, order: [20, 100] },
  { name: 'پالێتی پلاستیکی 120×80', depositPrice: 35_000, minStock: 120, stock: 110, unitCost: 26_000, order: [5, 25] },
  { name: 'پالێتی سووک 100×80', depositPrice: 9_000, minStock: 60, stock: 300, unitCost: 6_000, order: [10, 60] },
  {
    name: 'پالێتی دوو ڕوو 120×100',
    depositPrice: 18_000,
    minStock: 40,
    stock: 200,
    unitCost: 12_500,
    order: [10, 50],
  },
  { name: 'پالێتی کیمیایی 114×114', depositPrice: 25_000, minStock: 30, stock: 120, unitCost: 18_000, order: [5, 30] },
  { name: 'سندوقی پالێت 120×80', depositPrice: 45_000, minStock: 20, stock: 60, unitCost: 33_000, order: [2, 10] },
] as const;

/** `weight` is how often the customer orders. A credit limit caps the deposit value of the pallets a customer holds (§4.4). */
const CUSTOMERS = [
  {
    name: 'کارگەی چیمەنتۆی هەولێر',
    phone: '07501110001',
    altPhone: '07701110001',
    address: 'هەولێر، ناوچەی پیشەسازی، شەقامی 100 مەتری',
    creditLimit: 25_000_000,
    weight: 5,
  },
  {
    name: 'کۆمپانیای ئاوی زاخۆ',
    phone: '07501110002',
    altPhone: null,
    address: 'زاخۆ، ڕێگای ئیبراهیم خەلیل',
    creditLimit: 10_000_000,
    weight: 3,
  },
  {
    name: 'Kurdistan Food Industries',
    phone: '07501110003',
    altPhone: '07511110003',
    address: 'Erbil, Kasnazan industrial zone',
    creditLimit: null,
    weight: 4,
  },
  {
    name: 'شركة النصر للتجارة',
    phone: '07701110004',
    altPhone: null,
    address: 'الموصل، حي الصناعة',
    creditLimit: 5_000_000,
    weight: 2,
  },
  {
    name: 'کۆگاکانی سلێمانی',
    phone: '07701110005',
    altPhone: null,
    address: 'سلێمانی، شەقامی سالم',
    creditLimit: 4_000_000,
    weight: 2,
  },
  {
    name: 'Newroz Plastic Co.',
    phone: '07501110006',
    altPhone: null,
    address: 'Erbil, Pirzin road',
    creditLimit: 6_000_000,
    weight: 2,
  },
  {
    name: 'مارکێتی فامیلی مۆڵ',
    phone: '07501110007',
    altPhone: '07501110077',
    address: 'هەولێر، شەقامی 60 مەتری',
    creditLimit: null,
    weight: 2,
  },
  {
    name: 'کارگەی شیرینی دهۆک',
    phone: '07501110008',
    altPhone: null,
    address: 'دهۆک، ناوچەی پیشەسازی',
    creditLimit: 2_500_000,
    weight: 1,
  },
  {
    name: 'کۆمپانیای گواستنەوەی ڕوانگە',
    phone: '07501110009',
    altPhone: null,
    address: 'هەولێر، ڕێگای کەرکووک',
    creditLimit: 8_000_000,
    weight: 2,
  },
  {
    name: 'Darin Beverages',
    phone: '07701110010',
    altPhone: null,
    address: 'Duhok, Semel road',
    creditLimit: null,
    weight: 1,
  },
] as const;

const DRIVERS = [
  { name: 'کاروان عەزیز', phone: '07701230001', carNumber: '22 A 41573' },
  { name: 'هێمن مەحمود', phone: '07501230002', carNumber: '22 B 60218' },
  { name: 'Ahmed Salih', phone: '07701230003', carNumber: '21 A 11946' },
  { name: 'ڕێبوار قادر', phone: '07511230004', carNumber: '24 C 30785' },
  { name: 'سەردار ئەحمەد', phone: '07501230005', carNumber: '22 D 51234' },
  { name: 'Omar Khalid', phone: '07701230006', carNumber: '23 A 77410' },
  { name: 'بەختیار حەسەن', phone: '07511230007', carNumber: '22 A 90312' },
  { name: 'دڵشاد عومەر', phone: '07501230008', carNumber: '24 B 18865' },
  { name: 'Yousif Jamal', phone: '07701230009', carNumber: '21 C 43027' },
  { name: 'ئاراس ڕەشید', phone: '07501230010', carNumber: '22 C 66591' },
] as const;

const ORDER_NOTES = ['بۆ کۆگای نوێ', 'گەیاندن پێش نیوەڕۆ', null, null, null, null] as const;

type Event = { kind: 'return' | 'secondReturn' | 'payment'; orderId: number };

/** Every table the seed writes rows to with a database-filled `created_at`. A literal list, never input. */
const TIMESTAMPED = [
  'items',
  'purchase_batches',
  'customers',
  'drivers',
  'orders',
  'order_lines',
  'returns',
  'return_lines',
  'ledger_entries',
  'stock_movements',
  'audit_logs',
] as const;
type Timestamped = (typeof TIMESTAMPED)[number];
/** The tables whose triggers refuse every UPDATE (§5). */
const APPEND_ONLY = ['audit_logs', 'ledger_entries', 'return_lines', 'returns', 'stock_movements'] as const;

/** After one operation: the moved time it ran at, and each table's highest id once it had run. */
interface Stamp {
  at: Date;
  upTo: Record<Timestamped, number>;
}

async function highestIds(prisma: PrismaService): Promise<Record<Timestamped, number>> {
  const columns = TIMESTAMPED.map(
    (table) => Prisma.sql`(SELECT COALESCE(MAX(id), 0) FROM ${Prisma.raw(table)})::int AS ${Prisma.raw(table)}`,
  );
  const [row] = await prisma.$queryRaw<Record<Timestamped, number>[]>`SELECT ${Prisma.join(columns)}`;
  if (!row) throw new Error('could not read the highest ids');
  return row;
}

/**
 * The owner connection that dates the rows, checked to reach the very database the seed writes to — the same
 * server (its start time and port) and the same database — before anything is written. The two URLs are
 * configured apart; dating another database's rows by this run's ids would scramble their times.
 */
async function ownerOf(prisma: PrismaService): Promise<PrismaClient> {
  const url = process.env.DATABASE_MIGRATE_URL;
  if (!url) throw new Error('Missing DATABASE_MIGRATE_URL (the owner role dates the rows)');
  const owner = createPrismaClient(url);
  const identity = Prisma.sql`SELECT current_database() || ' on port ' || COALESCE(inet_server_port()::text, 'socket')
    || ', started ' || pg_postmaster_start_time()::text AS name`;
  const [[seeded], [dated]] = await Promise.all([
    prisma.$queryRaw<{ name: string }[]>(identity),
    owner.$queryRaw<{ name: string }[]>(identity),
  ]);
  if (!seeded || seeded.name !== dated?.name) {
    await owner.$disconnect();
    throw new Error(
      `DATABASE_URL (${seeded?.name}) and DATABASE_MIGRATE_URL (${dated?.name}) reach different databases`,
    );
  }
  return owner;
}

/**
 * Gives each demo row the time of the operation that wrote it. Operations run one after another, so the rows
 * an operation wrote are those above the previous operation's highest id and up to its own. Development only,
 * as the owner, in one transaction: the append-only triggers are switched off for these UPDATEs alone and
 * switched back on before it commits, so no other session ever sees them off.
 */
async function backdate(owner: PrismaClient, baseline: Record<Timestamped, number>, stamps: Stamp[]): Promise<void> {
  try {
    await owner.$transaction(
      async (tx) => {
        for (const table of APPEND_ONLY) await tx.$executeRaw`ALTER TABLE ${Prisma.raw(table)} DISABLE TRIGGER USER`;
        for (const table of TIMESTAMPED) {
          let previous = baseline[table];
          const ranges: Prisma.Sql[] = [];
          for (const stamp of stamps) {
            const upTo = stamp.upTo[table];
            if (upTo > previous) ranges.push(Prisma.sql`(${previous}::int, ${upTo}::int, ${stamp.at}::timestamptz)`);
            previous = upTo;
          }
          if (ranges.length === 0) continue;
          await tx.$executeRaw`
            UPDATE ${Prisma.raw(table)} AS t SET created_at = r.at
            FROM (VALUES ${Prisma.join(ranges)}) AS r(lo, hi, at)
            WHERE t.id > r.lo AND t.id <= r.hi`;
        }
        // An order last changed with its latest return, ledger row, cancellation or reversal.
        await tx.$executeRaw`
          UPDATE orders o SET updated_at = GREATEST(
            o.created_at, o.cancelled_at,
            (SELECT MAX(GREATEST(r.created_at, r.reversed_at)) FROM returns r WHERE r.order_id = o.id),
            (SELECT MAX(le.created_at) FROM ledger_entries le WHERE le.order_id = o.id))`;
        await tx.$executeRaw`UPDATE order_lines l SET updated_at = o.updated_at FROM orders o WHERE o.id = l.order_id`;
        await tx.$executeRaw`UPDATE items SET updated_at = COALESCE(archived_at, created_at)`;
        await tx.$executeRaw`UPDATE purchase_batches SET updated_at = created_at`;
        await tx.$executeRaw`UPDATE customers SET updated_at = created_at`;
        await tx.$executeRaw`UPDATE drivers SET updated_at = created_at`;
        const [first] = stamps;
        if (first) await tx.$executeRaw`UPDATE factory_settings SET updated_at = ${first.at}::timestamptz`;
        for (const table of APPEND_ONLY) await tx.$executeRaw`ALTER TABLE ${Prisma.raw(table)} ENABLE TRIGGER USER`;
      },
      { timeout: 60_000 },
    );
  } finally {
    await owner.$disconnect();
  }
}

/** Set once the seed may have written something. */
let started = false;

async function main(): Promise<void> {
  const env = process.env.NODE_ENV ?? 'development';
  if (env === 'production') throw new Error('seed-demo is for development only');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const [items, customers, orders] = await Promise.all([
      prisma.item.count(),
      prisma.customer.count(),
      prisma.order.count(),
    ]);
    if (items + customers + orders > 0) {
      throw new Error('the database already holds items, customers or orders; run it on a fresh database');
    }
    const adminRow = await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, orderBy: { id: 'asc' } });
    if (!adminRow) throw new Error('no active admin: run `pnpm db:seed` first');
    // Checked before anything is written, so a misconfigured run leaves the database as it was.
    const owner = await ownerOf(prisma);
    started = true;

    const actor: AuthContext = {
      userId: adminRow.id,
      username: adminRow.username,
      displayName: adminRow.displayName,
      role: adminRow.role,
      isAdmin: true,
      mustChangePassword: adminRow.mustChangePassword,
      permissions: new Set(PERMISSION_KEYS),
      canViewCost: true,
      ip: '127.0.0.1',
      requestId: 'seed-demo',
    };

    // The services read "now" from the one Clock instance; walking it back and forward dates every row.
    // Never past the real time, so today's rows are not stamped in the future.
    const clock = app.get(Clock);
    const realNow = Date.now();
    let now = new Date(realNow);
    clock.now = () => new Date(now);
    const today = businessToday(now);
    const start = addDays(today, -DAYS);
    const openDay = (date: string): void => {
      now = new Date(Math.min(businessDayStartUtc(date).getTime() + 8 * 60 * MINUTE, realNow));
    };
    const tick = (): void => {
      now = new Date(Math.min(now.getTime() + between(6, 40) * MINUTE, realNow));
    };

    const idempotency = app.get(IdempotencyService);
    const request = (scope: IdempotencyScope, path: string, body: unknown): IdempotentRequest => ({
      userId: actor.userId,
      key: randomUUID(),
      scope,
      requestHash: idempotency.requestHash('POST', path, body),
    });
    const baseline = await highestIds(prisma);
    const stamps: Stamp[] = [];
    const as = async <T>(work: () => Promise<T>): Promise<T> => {
      tick();
      const at = new Date(now);
      try {
        return await RequestContext.run({ requestId: 'seed-demo', ip: actor.ip, userId: actor.userId }, work);
      } finally {
        // A refused operation wrote nothing; its stamp still closes the id range for the next one.
        stamps.push({ at, upTo: await highestIds(prisma) });
      }
    };
    const refused = (error: unknown, ...codes: string[]): boolean =>
      error instanceof ApiError && codes.includes(error.code);

    const settings = app.get(SettingsService);
    const itemsService = app.get(ItemsService);
    const purchases = app.get(PurchasesService);
    const customersService = app.get(CustomersService);
    const drivers = app.get(DriversService);
    const ordersService = app.get(OrdersService);
    const changes = app.get(OrderChangesService);
    const returns = app.get(ReturnsService);
    const payments = app.get(PaymentsService);

    const tally = {
      orders: 0,
      cash: 0,
      lent: 0,
      returns: 0,
      payments: 0,
      cancelled: 0,
      restocks: 0,
      overrides: 0,
      reduced: 0,
      reversed: 0,
    };

    // ── Day one: the factory, its catalogue, customers and drivers ──
    openDay(start);
    const current = await settings.get();
    await as(() =>
      settings.update(
        SettingsUpdateBody.parse({
          version: current.version,
          factoryName: 'کارگەی پالێتی هەولێر',
          phone: '0750 111 2233',
          address: 'هەولێر، ناوچەی پیشەسازی، نزیک فلکەی داروتوو',
          logoUploadId: null,
        }),
        actor,
      ),
    );
    const catalogue: ((typeof ITEMS)[number] & { id: number })[] = [];
    for (const spec of ITEMS) {
      const item = await as(() =>
        itemsService.create(
          ItemCreateBody.parse({
            name: spec.name,
            depositPrice: spec.depositPrice,
            minStock: spec.minStock,
            initialBatch: { date: start, quantity: spec.stock, unitCost: spec.unitCost, note: 'کۆگای سەرەتایی' },
          }),
          actor,
        ),
      );
      catalogue.push({ ...spec, id: item.id });
    }
    const people: { id: number; weight: number }[] = [];
    for (const spec of CUSTOMERS) {
      const { weight, ...body } = spec;
      const customer = await as(() => customersService.create(CustomerCreateBody.parse(body), actor));
      people.push({ id: customer.id, weight });
    }
    const fleet: number[] = [];
    for (const spec of DRIVERS) fleet.push((await as(() => drivers.create(DriverCreateBody.parse(spec), actor))).id);
    // One old model, sold out and taken off the list: the tenth item.
    const retired = await as(() =>
      itemsService.create(ItemCreateBody.parse({ name: 'پالێتی کۆن 100×100', depositPrice: 9_000 }), actor),
    );
    await as(() => itemsService.archive(retired.id, retired.version, actor));

    const weighted = people.flatMap((customer) => Array.from({ length: customer.weight }, () => customer));
    const agenda = new Map<string, Event[]>();
    const plan = (planned: string, event: Event): void => {
      // The yard is closed on Fridays: what falls on one happens the next morning.
      const date = isFriday(planned) ? addDays(planned, 1) : planned;
      if (date > today) return;
      agenda.set(date, [...(agenda.get(date) ?? []), event]);
    };
    const restock = async (date: string, itemIds: number[], note: string): Promise<void> => {
      for (const itemId of itemIds) {
        const spec = catalogue.find((item) => item.id === itemId);
        if (!spec) continue;
        // Timber gets dearer over the two months.
        const unitCost = roundTo(spec.unitCost * (1 + between(0, 12) / 100), 250);
        await as(() =>
          purchases.create(
            PurchaseBatchCreateBody.parse({ itemId, date, quantity: roundTo(spec.stock * 0.5, 10), unitCost, note }),
            actor,
          ),
        );
        tally.restocks += 1;
      }
    };

    const createOrder = async (date: string, index: number): Promise<void> => {
      const customer = weighted[Math.floor(random() * weighted.length)] ?? weighted[0];
      if (!customer) return;
      // One to three different items, any of the nine on the list.
      const pool = [...catalogue];
      const chosen = Array.from({ length: between(1, 3) }, () => pool.splice(between(0, pool.length - 1), 1)[0]).filter(
        (item) => item !== undefined,
      );
      const lines = chosen.map((item) => ({
        itemId: item.id,
        quantity: roundTo(between(item.order[0], item.order[1]), 5),
      }));
      const paymentType = chance(0.25) ? 'CASH' : 'LENT';
      const note = ORDER_NOTES[between(0, ORDER_NOTES.length - 1)] ?? null;

      let order: OrderDetailDto | undefined;
      let override = false;
      for (let attempt = 0; attempt < 4 && !order; attempt += 1) {
        const body = OrderCreateBody.parse({
          customerId: customer.id,
          driverId: fleet[between(0, fleet.length - 1)],
          date,
          paymentType,
          notes: note,
          lines,
          confirmCreditOverride: override,
        });
        try {
          order = (await as(() => ordersService.create(body, actor, request('ORDER_CREATE', '/api/orders', body))))
            .body;
        } catch (error) {
          if (refused(error, 'CREDIT_LIMIT_EXCEEDED')) {
            // Over the limit: a few times the admin lets a good customer through; otherwise the load is halved.
            if (tally.overrides < 3 && chance(0.3)) {
              override = true;
              tally.overrides += 1;
            } else {
              for (const line of lines) line.quantity = roundTo(line.quantity / 2, 5);
              tally.reduced += 1;
            }
          } else if (refused(error, 'STOCK_INSUFFICIENT')) {
            await restock(
              date,
              lines.map((line) => line.itemId),
              'داواکاری پەلە لە دارتاش',
            );
          } else {
            throw error;
          }
        }
      }
      if (!order) return;
      tally.orders += 1;
      tally[paymentType === 'CASH' ? 'cash' : 'lent'] += 1;

      // One customer rings back the same morning and calls it off.
      if (index === CANCELLED_ORDER) {
        const placed = order;
        await as(() => changes.cancel(placed.id, placed.version, actor));
        tally.cancelled += 1;
        return;
      }
      if (chance(0.7)) plan(addDays(date, between(3, 16)), { kind: 'return', orderId: order.id });
      if (paymentType === 'LENT' && chance(0.9))
        plan(addDays(date, between(2, 20)), { kind: 'payment', orderId: order.id });
    };

    const recordReturn = async (date: string, event: Event): Promise<void> => {
      const order = await ordersService.get(event.orderId);
      if (order.status !== 'OPEN') return;
      // A first return often brings back part of the load; the rest follows later.
      const partial = event.kind === 'return' && chance(0.35);
      const lines = order.lines
        .filter((line) => line.outQuantity > 0)
        .map((line) => {
          const back = partial ? roundTo(line.outQuantity * (0.4 + random() * 0.3), 5) : line.outQuantity;
          const quantity = Math.min(back, line.outQuantity);
          const damagedQuantity = chance(0.3)
            ? Math.min(quantity, between(1, Math.max(1, Math.floor(quantity * 0.06))))
            : 0;
          // Lightly damaged pallets are sometimes refunded at half their deposit.
          const damagedRefund =
            damagedQuantity > 0 && chance(0.4) ? roundTo((damagedQuantity * line.unitDeposit) / 2, 250) : 0;
          return { orderLineId: line.id, acceptedQuantity: quantity - damagedQuantity, damagedQuantity, damagedRefund };
        });
      if (lines.length === 0) return;
      const notes = lines.some((line) => line.damagedQuantity > 0) ? 'هەندێک پالێت شکاو گەڕایەوە' : null;
      const body = ReturnCreateBody.parse({ date, notes, lines });
      const path = `/api/orders/${order.id}/returns`;
      await as(() => returns.create(order.id, body, actor, request('RETURN_CREATE', path, body)));
      tally.returns += 1;
      if (partial) plan(addDays(date, between(5, 12)), { kind: 'secondReturn', orderId: order.id });
    };

    let paymentsSoFar = 0;
    const recordPayment = async (date: string, event: Event): Promise<void> => {
      const order = await ordersService.get(event.orderId);
      if (order.status !== 'OPEN' || order.owed <= 0) return;
      const amount = chance(0.5) ? order.owed : Math.min(order.owed, roundTo(order.owed * 0.5, 5_000));
      const body = PaymentCreateBody.parse({ date, amount, note: chance(0.3) ? 'پارەی کاش لە ئۆفیس' : undefined });
      const path = `/api/orders/${order.id}/payments`;
      const result = await as(() => payments.create(order.id, body, actor, request('PAYMENT_CREATE', path, body)));
      tally.payments += 1;
      paymentsSoFar += 1;
      // One payment keyed against the wrong order, taken back the same day.
      if (paymentsSoFar === 3) {
        await as(() =>
          payments.reverse(
            result.body.ledgerEntryId,
            LedgerEntryReverseBody.parse({ note: 'بە هەڵە لەسەر ئەم داواکارییە تۆمار کرا' }),
            actor,
          ),
        );
        tally.reversed += 1;
      }
    };

    // Planned days are counted from the start; one that falls on a Friday moves to the Saturday.
    const workingDay = (day: number): string => {
      const planned = addDays(start, day);
      return isFriday(planned) ? addDays(planned, 1) : planned;
    };
    const orderOn = new Map(ORDER_DAYS.map((day, index) => [workingDay(day), index] as const));
    const deliveryDay = workingDay(28);
    const countFoundDay = workingDay(34);
    const breakageDay = workingDay(50);

    // ── Two months of working days ──
    for (let offset = 0; offset <= DAYS; offset += 1) {
      const date = addDays(start, offset);
      if (offset > 0) openDay(date);
      if (isFriday(date)) continue;

      // Morning: pallets come back and customers settle up.
      for (const event of agenda.get(date) ?? []) {
        try {
          if (event.kind === 'payment') await recordPayment(date, event);
          else await recordReturn(date, event);
        } catch (error) {
          if (!refused(error, 'PAYMENT_EXCEEDS_OWED', 'RETURN_EXCEEDS_OUT', 'RETURN_EMPTY')) throw error;
        }
      }

      if (date === deliveryDay) {
        // One delivery from the carpenter for the three wooden pallets that go out most; the plastic pallets come
        // from a supplier abroad and miss it, so they end the period low.
        await restock(
          date,
          catalogue.slice(0, 3).map((item) => item.id),
          'بارێکی نوێ لە دارتاش',
        );
      }
      if (date === countFoundDay) {
        const [euro] = catalogue;
        if (euro) {
          await as(() =>
            itemsService.adjustStock(
              euro.id,
              StockAdjustmentCreateBody.parse({ quantity: 12, note: 'ژماردنەوەی کۆگا: 12 پالێت لە حەوشە دۆزرایەوە' }),
              actor,
            ),
          );
        }
      }
      if (date === breakageDay) {
        const standard = catalogue[1];
        // Only when there are eight in the yard to write off; the adjustment would be refused otherwise.
        if (standard && (await itemsService.get(standard.id)).quantityOnHand >= 8) {
          await as(() =>
            itemsService.adjustStock(
              standard.id,
              StockAdjustmentCreateBody.parse({ quantity: -8, note: 'شکان لە کاتی بارکردن لە کۆگا' }),
              actor,
            ),
          );
        }
      }

      // The rest of the day: an order goes out on the order days.
      const index = orderOn.get(date);
      if (index !== undefined) await createOrder(date, index);
    }

    await backdate(owner, baseline, stamps);
    const discrepancies = await findLedgerDiscrepancies(prisma);
    console.log(
      `[seed-demo] ${start} → ${today}: ${tally.orders} orders (${tally.lent} lent, ${tally.cash} cash, ` +
        `${tally.cancelled} cancelled; ${tally.overrides} credit overrides, ${tally.reduced} loads halved at the limit), ` +
        `${tally.returns} returns, ${tally.payments} payments (${tally.reversed} reversed), ${tally.restocks} purchase batches`,
    );
    console.log(`[seed-demo] reconcile: ${discrepancies.length} discrepancies`);
    if (discrepancies.length > 0) {
      for (const discrepancy of discrepancies) console.log(JSON.stringify(discrepancy));
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('[seed-demo] failed:', error instanceof Error ? error.message : error);
  // Nothing undoes the rows already written, and the empty-database check refuses a second run on them.
  if (started) console.error('[seed-demo] the database is partly seeded: reset it before running the seed again');
  process.exit(1);
});
