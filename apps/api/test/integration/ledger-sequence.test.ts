import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { OrderDetailDto, PageDto, PurchaseBatchDto } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { PrismaService } from '../../src/prisma/prisma.service';
import { findLedgerDiscrepancies } from '../../src/prisma/reconciliation';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { createCustomer, createDriver, createItem } from '../helpers/factories';

const NOW = new Date('2026-09-11T09:00:00Z');
const TODAY = '2026-09-11';
const SEED = 20260911;
const OPERATIONS = 200;

/** mulberry32: a small deterministic generator, so a failing sequence can be replayed exactly. */
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

/**
 * I14 (§14.3): a seeded sequence of operations across every endpoint that moves stock or money —
 * orders created, edited and cancelled; returns recorded, corrected and deleted; payments recorded and
 * reversed; batches added, edited and deleted; stock adjusted — after which reconciliation finds
 * nothing, and every return's refund due is still what its lines say. Refusals (credit, stock,
 * activity, amounts) are part of the sequence: they must leave nothing behind.
 */
describe('I14: ledger reconciliation after a scripted sequence', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;

  beforeAll(async () => {
    app = await createTestApp({ clock: new FixedClock(NOW) });
    prisma = app.get(PrismaService);
    await resetDatabase();
    admin = await login(app);
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  it(`reconciles to zero after ${OPERATIONS} operations (seed ${SEED})`, { timeout: 300_000 }, async () => {
    const random = generator(SEED);
    const pick = <T>(values: readonly T[]): T | undefined => values[Math.floor(random() * values.length)];
    const between = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));
    const http = () => request(app.getHttpServer());

    const items = await Promise.all(
      [1_000, 2_500, 400].map((depositPrice, index) =>
        createItem(app, admin, { name: `Pallet ${index + 1}`, depositPrice, stock: between(150, 400) }),
      ),
    );
    const customers = await Promise.all(
      [null, 300_000, 1_000_000].map((creditLimit, index) =>
        createCustomer(app, admin, { name: `Customer ${index + 1}`, phone: `075000000${index}0`, creditLimit }),
      ),
    );
    const driver = await createDriver(app, admin);

    const refresh = async (orderId: number): Promise<OrderDetailDto> =>
      (await http().get(`/api/orders/${orderId}`).set(asUser(admin)).expect(200)).body as OrderDetailDto;
    const orderIds: number[] = [];
    const tally: Record<string, { ok: number; refused: number }> = {};
    const record = (name: string, status: number): void => {
      tally[name] ??= { ok: 0, refused: 0 };
      if (status >= 500) throw new Error(`${name} answered ${status}`);
      if (status < 300) tally[name].ok += 1;
      else tally[name].refused += 1;
    };

    const operations: Record<string, () => Promise<void>> = {
      async createOrder() {
        const lines = items.filter(() => random() < 0.6).map((item) => ({ itemId: item.id, quantity: between(1, 40) }));
        if (lines.length === 0) lines.push({ itemId: items[0]?.id ?? 0, quantity: between(1, 40) });
        const response = await http()
          .post('/api/orders')
          .set(asUser(admin))
          .set('Idempotency-Key', randomUUID())
          .send({
            customerId: pick(customers)?.id,
            driverId: driver.id,
            date: TODAY,
            paymentType: random() < 0.4 ? 'CASH' : 'LENT',
            lines,
            confirmCreditOverride: random() < 0.3,
          });
        record('createOrder', response.status);
        if (response.status === 201) orderIds.push((response.body as OrderDetailDto).id);
      },
      async editLines() {
        const orderId = pick(orderIds);
        if (!orderId) return;
        const order = await refresh(orderId);
        const lines = order.lines.map((line) => ({
          itemId: line.item.id,
          quantity: Math.max(1, line.quantity + between(-10, 10)),
        }));
        const response = await http()
          .patch(`/api/orders/${orderId}`)
          .set(asUser(admin))
          .send({ version: order.version, lines });
        record('editLines', response.status);
      },
      async cancel() {
        const orderId = pick(orderIds);
        if (!orderId || random() < 0.6) return;
        const order = await refresh(orderId);
        const response = await http()
          .post(`/api/orders/${orderId}/cancel`)
          .set(asUser(admin))
          .send({ version: order.version });
        record('cancel', response.status);
      },
      async recordReturn() {
        const orderId = pick(orderIds);
        if (!orderId) return;
        const order = await refresh(orderId);
        const lines = order.lines
          .filter((line) => line.outQuantity > 0 && random() < 0.8)
          .map((line) => {
            // Now and then more than is out, to exercise the refusal.
            const accepted = between(0, line.outQuantity + (random() < 0.1 ? 5 : 0));
            const damaged = between(0, Math.max(0, line.outQuantity - accepted));
            return {
              orderLineId: line.id,
              acceptedQuantity: accepted,
              damagedQuantity: damaged,
              damagedRefund: damaged > 0 && random() < 0.5 ? between(0, damaged * line.unitDeposit) : 0,
            };
          });
        const response = await http()
          .post(`/api/orders/${orderId}/returns`)
          .set(asUser(admin))
          .set('Idempotency-Key', randomUUID())
          .send({ date: TODAY, lines });
        record('recordReturn', response.status);
      },
      async correctReturn() {
        const orderId = pick(orderIds);
        if (!orderId) return;
        const order = await refresh(orderId);
        const standing = pick(order.returns.filter((pr) => !pr.reversed));
        if (!standing) return;
        const lines = standing.lines.map((line) => ({
          orderLineId: line.orderLineId,
          acceptedQuantity: Math.max(0, line.acceptedQuantity + between(-3, 3)),
          damagedQuantity: line.damagedQuantity,
          damagedRefund: 0,
        }));
        const response = await http()
          .post(`/api/returns/${standing.id}/replace`)
          .set(asUser(admin))
          .send({ date: TODAY, lines });
        record('correctReturn', response.status);
      },
      async deleteReturn() {
        const orderId = pick(orderIds);
        if (!orderId) return;
        const standing = pick((await refresh(orderId)).returns.filter((pr) => !pr.reversed));
        if (!standing) return;
        record('deleteReturn', (await http().delete(`/api/returns/${standing.id}`).set(asUser(admin))).status);
      },
      async pay() {
        const orderId = pick(orderIds);
        if (!orderId) return;
        const order = await refresh(orderId);
        // Sometimes more than is owed, or on a cash order, to exercise the refusals.
        const amount = Math.max(1, random() < 0.15 ? order.owed + 1 : between(1, Math.max(1, order.owed)));
        const response = await http()
          .post(`/api/orders/${orderId}/payments`)
          .set(asUser(admin))
          .set('Idempotency-Key', randomUUID())
          .send({ date: TODAY, amount });
        record('pay', response.status);
      },
      async reversePayment() {
        const orderId = pick(orderIds);
        if (!orderId) return;
        const payment = pick((await refresh(orderId)).ledgerEntries.filter((entry) => entry.canReverse));
        if (!payment) return;
        record(
          'reversePayment',
          (await http().post(`/api/ledger-entries/${payment.id}/reverse`).set(asUser(admin)).send({})).status,
        );
      },
      async addBatch() {
        const response = await http()
          .post('/api/purchase-batches')
          .set(asUser(admin))
          .send({ itemId: pick(items)?.id, date: TODAY, quantity: between(1, 80), unitCost: 700 });
        record('addBatch', response.status);
      },
      async changeBatch() {
        const batches = (await http().get('/api/purchase-batches?pageSize=100').set(asUser(admin)).expect(200))
          .body as PageDto<PurchaseBatchDto>;
        const batch = pick(batches.items);
        if (!batch) return;
        const response =
          random() < 0.5
            ? await http()
                .patch(`/api/purchase-batches/${batch.id}`)
                .set(asUser(admin))
                .send({ version: batch.version, quantity: Math.max(1, batch.quantity + between(-60, 20)) })
            : await http().delete(`/api/purchase-batches/${batch.id}?version=${batch.version}`).set(asUser(admin));
        record('changeBatch', response.status);
      },
      async adjustStock() {
        const response = await http()
          .post(`/api/items/${pick(items)?.id}/stock-adjustments`)
          .set(asUser(admin))
          .send({ quantity: between(-30, 30) || 1, note: 'Counted' });
        record('adjustStock', response.status);
      },
    };

    const weighted: (keyof typeof operations)[] = [
      ...Array<keyof typeof operations>(5).fill('createOrder'),
      ...Array<keyof typeof operations>(2).fill('editLines'),
      'cancel',
      ...Array<keyof typeof operations>(5).fill('recordReturn'),
      ...Array<keyof typeof operations>(2).fill('correctReturn'),
      'deleteReturn',
      ...Array<keyof typeof operations>(4).fill('pay'),
      'reversePayment',
      'addBatch',
      'changeBatch',
      'adjustStock',
    ];
    for (let step = 0; step < OPERATIONS; step += 1) {
      const name = pick(weighted) ?? 'createOrder';
      await operations[name]?.();
    }

    expect(await findLedgerDiscrepancies(prisma)).toEqual([]);
    const refundMismatches = await prisma.$queryRaw<{ id: number }[]>`
      SELECT r.id FROM returns r
      JOIN return_lines rl ON rl.return_id = r.id
      GROUP BY r.id, r.refund_due
      HAVING r.refund_due <> SUM(rl.accepted_quantity * rl.unit_deposit + rl.damaged_refund)::bigint`;
    expect(refundMismatches).toEqual([]);

    // The sequence must actually have exercised every operation, successes and refusals alike.
    for (const name of Object.keys(operations)) expect(tally[name]?.ok ?? 0, name).toBeGreaterThan(0);
    const refusals = Object.values(tally).reduce((total, counts) => total + counts.refused, 0);
    expect(refusals).toBeGreaterThan(0);
  });
});
