import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { CustomerDto, DriverDto, ItemDto, OrderDetailDto, ReturnResultDto } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import {
  EMPLOYEE_PASSWORD,
  createCustomer,
  createDriver,
  createEmployee,
  createItem,
  createOrder,
  recordPayment,
} from '../helpers/factories';

/** "today = 2026-09-11" of the worked examples (§4.10), midday in Baghdad. */
const NOW = new Date('2026-09-11T09:00:00Z');
const TODAY = '2026-09-11';

type Entry = { acceptedQuantity: number; damagedQuantity: number; damagedRefund?: number; orderLineId?: number };

describe('returns (§4.8.4–§4.8.6, §6.20)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;
  let item: ItemDto;
  let customer: CustomerDto;
  let driver: DriverDto;

  beforeAll(async () => {
    app = await createTestApp({ clock: new FixedClock(NOW) });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    admin = await login(app);
    item = await createItem(app, admin, { name: 'Pallet 120×100', depositPrice: 1_000, stock: 500 });
    customer = await createCustomer(app, admin);
    driver = await createDriver(app, admin);
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const order100 = (paymentType: 'CASH' | 'LENT'): Promise<OrderDetailDto> =>
    createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: TODAY,
      paymentType,
      lines: [{ itemId: item.id, quantity: 100 }],
    });
  const lineOf = (order: OrderDetailDto): number => order.lines[0]?.id ?? 0;
  const entries = (order: OrderDetailDto, list: Entry[]) =>
    list.map((entry) => ({ orderLineId: lineOf(order), damagedRefund: 0, ...entry }));
  const postReturn = (
    order: OrderDetailDto,
    list: Entry[],
    options: { session?: Session; key?: string; date?: string } = {},
  ) =>
    http()
      .post(`/api/orders/${order.id}/returns`)
      .set(asUser(options.session ?? admin))
      .set('Idempotency-Key', options.key ?? randomUUID())
      .send({ date: options.date ?? TODAY, lines: entries(order, list) });
  const returnOf = async (order: OrderDetailDto, list: Entry[]): Promise<ReturnResultDto> =>
    (await postReturn(order, list).expect(201)).body as ReturnResultDto;
  const replace = (returnId: number, order: OrderDetailDto, list: Entry[]) =>
    http()
      .post(`/api/returns/${returnId}/replace`)
      .set(asUser(admin))
      .send({ date: TODAY, lines: entries(order, list) });
  const remove = (returnId: number, session: Session = admin) =>
    http().delete(`/api/returns/${returnId}`).set(asUser(session));

  const onHand = async (): Promise<number> =>
    (await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).quantityOnHand;
  const ledger = (orderId: number) =>
    prisma.ledgerEntry.findMany({
      where: { orderId },
      orderBy: { id: 'asc' },
      select: { type: true, source: true, amount: true, date: true, returnId: true, reversesEntryId: true },
    });
  const returnMovements = (orderId: number) =>
    prisma.stockMovement.findMany({
      where: { orderId, returnId: { not: null } },
      orderBy: { id: 'asc' },
      select: { reason: true, quantity: true, returnId: true },
    });
  const money = (order: OrderDetailDto) => ({
    depositTotal: order.depositTotal,
    payments: order.paymentsNet,
    credits: order.creditsTotal,
    refundsPaid: order.refundsNet,
    owed: order.owed,
    outValue: order.outValue,
    held: order.held,
    compensation: order.compensation,
    status: order.status,
  });

  it('E1 — a cash order returned in full refunds the whole deposit and settles', async () => {
    const order = await order100('CASH');

    const result = await returnOf(order, [{ acceptedQuantity: 100, damagedQuantity: 0 }]);

    expect(money(result.order)).toEqual({
      depositTotal: 100_000,
      payments: 100_000,
      credits: 100_000,
      refundsPaid: 100_000,
      owed: 0,
      outValue: 0,
      held: 0,
      compensation: 0,
      status: 'SETTLED',
    });
    const stored = await prisma.palletReturn.findUniqueOrThrow({ where: { id: result.returnId } });
    expect([stored.refundDue, stored.owedBefore, stored.cashRefund]).toEqual([100_000n, 0n, 100_000n]);
    expect(await ledger(order.id)).toEqual([
      expect.objectContaining({ type: 'PAYMENT', source: 'ORDER_CREATE', amount: 100_000n }),
      {
        type: 'REFUND',
        source: 'RETURN_CREATE',
        amount: 100_000n,
        date: new Date(`${TODAY}T00:00:00.000Z`),
        returnId: result.returnId,
        reversesEntryId: null,
      },
    ]);
    expect(await returnMovements(order.id)).toEqual([
      { reason: 'RETURN_ACCEPTED', quantity: 100, returnId: result.returnId },
    ]);
    expect(await onHand()).toBe(500);
    expect(result.order.returns).toHaveLength(1);
  });

  it('E2 — accepted and damaged on a cash order: damaged pallets never come back to stock', async () => {
    const order = await order100('CASH');

    const result = await returnOf(order, [{ acceptedQuantity: 90, damagedQuantity: 10 }]);

    expect(money(result.order)).toMatchObject({ credits: 90_000, refundsPaid: 90_000, owed: 0, compensation: 10_000 });
    expect(result.order.status).toBe('SETTLED');
    expect(await onHand()).toBe(490);
    const stock = (await http().get(`/api/items/${item.id}`).set(asUser(admin)).expect(200)).body as ItemDto;
    expect(stock.damagedTotal).toBe(10);
  });

  it('E3, E4 — on a credit order a return lowers what is owed and refunds nothing', async () => {
    const e3 = await order100('LENT');
    const r3 = await returnOf(e3, [{ acceptedQuantity: 90, damagedQuantity: 10 }]);
    expect(money(r3.order)).toMatchObject({
      credits: 90_000,
      refundsPaid: 0,
      owed: 10_000,
      outValue: 0,
      compensation: 10_000,
    });
    expect(r3.order.status).toBe('OPEN');

    const e4 = await order100('LENT');
    const r4 = await returnOf(e4, [{ acceptedQuantity: 0, damagedQuantity: 50 }]);
    expect(money(r4.order)).toMatchObject({
      credits: 0,
      owed: 100_000,
      outValue: 50_000,
      held: 0,
      compensation: 50_000,
    });
    expect(await ledger(e4.id)).toEqual([]);
    expect(await returnMovements(e4.id)).toEqual([]);
    expect(await onHand()).toBe(500 - 100 + 90 - 100);
  });

  it('E5, E6 — the second return refunds what was paid beyond the pallets still out', async () => {
    const order = await order100('LENT');
    await recordPayment(app, admin, { orderId: order.id, amount: 40_000, date: TODAY });

    const r1 = await returnOf(order, [{ acceptedQuantity: 50, damagedQuantity: 0 }]);
    expect(money(r1.order)).toMatchObject({
      payments: 40_000,
      credits: 50_000,
      refundsPaid: 0,
      owed: 10_000,
      held: 40_000,
    });

    const r2 = await returnOf(r1.order, [{ acceptedQuantity: 50, damagedQuantity: 0 }]);
    expect(money(r2.order)).toMatchObject({ credits: 100_000, refundsPaid: 40_000, owed: 0, outValue: 0, held: 0 });
    expect(r2.order.status).toBe('SETTLED');
    const second = await prisma.palletReturn.findUniqueOrThrow({ where: { id: r2.returnId } });
    expect([second.refundDue, second.owedBefore, second.cashRefund]).toEqual([50_000n, 10_000n, 40_000n]);
    expect(await onHand()).toBe(500);
  });

  it('E8, I3 — deleting a return takes its pallets back out and reverses its refund, once', async () => {
    const order = await order100('CASH');
    const recorded = await returnOf(order, [{ acceptedQuantity: 50, damagedQuantity: 0 }]);
    expect(await onHand()).toBe(450);

    const deleted = (await remove(recorded.returnId).expect(200)).body as ReturnResultDto;

    expect(deleted.returnId).toBe(recorded.returnId);
    expect(money(deleted.order)).toMatchObject({
      credits: 0,
      refundsPaid: 0,
      owed: 0,
      outValue: 100_000,
      held: 100_000,
    });
    expect(deleted.order.status).toBe('OPEN');
    expect(await onHand()).toBe(400);
    const rows = await ledger(order.id);
    expect(rows[2]).toEqual({
      type: 'REFUND_REVERSAL',
      source: 'RETURN_DELETE',
      amount: 50_000n,
      date: new Date(`${TODAY}T00:00:00.000Z`),
      returnId: recorded.returnId,
      reversesEntryId: expect.any(Number),
    });
    expect(await returnMovements(order.id)).toEqual([
      { reason: 'RETURN_ACCEPTED', quantity: 50, returnId: recorded.returnId },
      { reason: 'RETURN_DELETE', quantity: -50, returnId: recorded.returnId },
    ]);
    const stored = await prisma.palletReturn.findUniqueOrThrow({ where: { id: recorded.returnId } });
    expect(stored.reversalKind).toBe('DELETE');
    expect(stored.reversedByUserId).not.toBeNull();

    const again = await remove(recorded.returnId).expect(409);
    expect(again.body).toMatchObject({
      error: { code: 'RETURN_ALREADY_REVERSED', details: { returnId: recorded.returnId } },
    });
    await remove(999_999).expect(404);

    // A retried delete still says "already done" once the order it left without activity is cancelled.
    await http()
      .post(`/api/orders/${order.id}/cancel`)
      .set(asUser(admin))
      .send({ version: deleted.order.version })
      .expect(200);
    const afterCancel = await remove(recorded.returnId).expect(409);
    expect(afterCancel.body).toMatchObject({ error: { code: 'RETURN_ALREADY_REVERSED' } });
  });

  it('refuses to delete a return whose pallets have gone out again', async () => {
    const small = await createItem(app, admin, { name: 'Small pallet', depositPrice: 1_000, stock: 10 });
    const order = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: TODAY,
      lines: [{ itemId: small.id, quantity: 10 }],
    });
    const recorded = await returnOf(order, [{ acceptedQuantity: 10, damagedQuantity: 0 }]);
    await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: TODAY,
      lines: [{ itemId: small.id, quantity: 8 }],
    });

    const refused = await remove(recorded.returnId).expect(409);

    expect(refused.body).toMatchObject({
      error: { code: 'STOCK_INSUFFICIENT', details: { items: [{ itemId: small.id, requested: 10, available: 2 }] } },
    });
    expect((await prisma.palletReturn.findUniqueOrThrow({ where: { id: recorded.returnId } })).reversedAt).toBeNull();
  });

  it('U2, I2 — editing a return replaces it and refunds against the order without it', async () => {
    const order = await order100('CASH');
    const first = await returnOf(order, [{ acceptedQuantity: 50, damagedQuantity: 0 }]);

    const edited = (await replace(first.returnId, order, [{ acceptedQuantity: 40, damagedQuantity: 0 }]).expect(201))
      .body as ReturnResultDto;

    expect(edited.returnId).not.toBe(first.returnId);
    expect(money(edited.order)).toEqual({
      depositTotal: 100_000,
      payments: 100_000,
      credits: 40_000,
      refundsPaid: 40_000,
      owed: 0,
      outValue: 60_000,
      held: 60_000,
      compensation: 0,
      status: 'OPEN',
    });
    expect(edited.order.lines[0]?.outQuantity).toBe(60);
    const old = await prisma.palletReturn.findUniqueOrThrow({ where: { id: first.returnId } });
    expect([old.reversalKind, old.replacedByReturnId]).toEqual(['EDIT', edited.returnId]);
    const replacement = await prisma.palletReturn.findUniqueOrThrow({ where: { id: edited.returnId } });
    expect([replacement.refundDue, replacement.owedBefore, replacement.cashRefund]).toEqual([40_000n, 0n, 40_000n]);
    expect(await returnMovements(order.id)).toEqual([
      { reason: 'RETURN_ACCEPTED', quantity: 50, returnId: first.returnId },
      { reason: 'RETURN_EDIT', quantity: -50, returnId: first.returnId },
      { reason: 'RETURN_ACCEPTED', quantity: 40, returnId: edited.returnId },
    ]);
    expect((await ledger(order.id)).slice(1)).toEqual([
      expect.objectContaining({ type: 'REFUND', source: 'RETURN_CREATE', amount: 50_000n, returnId: first.returnId }),
      expect.objectContaining({
        type: 'REFUND_REVERSAL',
        source: 'RETURN_EDIT',
        amount: 50_000n,
        returnId: first.returnId,
      }),
      expect.objectContaining({ type: 'REFUND', source: 'RETURN_EDIT', amount: 40_000n, returnId: edited.returnId }),
    ]);
    expect(await onHand()).toBe(440);

    const audit = await prisma.auditLog.findMany({
      where: { action: { in: ['RETURN_EDIT', 'REFUND_REVERSE', 'REFUND_CREATE'] } },
      orderBy: { id: 'asc' },
      select: { action: true, entityId: true, summaryParams: true },
    });
    expect(audit.slice(1)).toEqual([
      {
        action: 'RETURN_EDIT',
        entityId: String(first.returnId),
        summaryParams: { orderNumber: order.orderNumber, newReturnId: edited.returnId },
      },
      expect.objectContaining({ action: 'REFUND_REVERSE' }),
      expect.objectContaining({ action: 'REFUND_CREATE' }),
    ]);

    const again = await replace(first.returnId, order, [{ acceptedQuantity: 30, damagedQuantity: 0 }]).expect(409);
    expect(again.body).toMatchObject({ error: { code: 'RETURN_ALREADY_REVERSED' } });
  });

  it('E10 — an edit that adds damage with a refund nets its stock and money', async () => {
    const order = await order100('CASH');
    const first = await returnOf(order, [{ acceptedQuantity: 60, damagedQuantity: 0 }]);
    expect(await onHand()).toBe(460);

    const edited = (
      await replace(first.returnId, order, [
        { acceptedQuantity: 50, damagedQuantity: 10, damagedRefund: 4_000 },
      ]).expect(201)
    ).body as ReturnResultDto;

    expect(money(edited.order)).toEqual({
      depositTotal: 100_000,
      payments: 100_000,
      credits: 54_000,
      refundsPaid: 54_000,
      owed: 0,
      outValue: 40_000,
      held: 40_000,
      compensation: 6_000,
      status: 'OPEN',
    });
    expect(await onHand()).toBe(450);
  });

  it('an edit is checked against the order without the return it replaces', async () => {
    const order = await order100('LENT');
    const first = await returnOf(order, [{ acceptedQuantity: 80, damagedQuantity: 0 }]);

    // 100 may come back once the 80 are set aside; 101 may not.
    const over = await replace(first.returnId, order, [{ acceptedQuantity: 101, damagedQuantity: 0 }]).expect(409);
    expect(over.body).toMatchObject({
      error: {
        code: 'RETURN_EXCEEDS_OUT',
        details: { lines: [{ orderLineId: lineOf(order), requested: 101, outQuantity: 100 }] },
      },
    });
    await replace(first.returnId, order, [{ acceptedQuantity: 100, damagedQuantity: 0 }]).expect(201);
  });

  it('I13 — validates a return against its order', async () => {
    const order = await order100('LENT');
    const other = await order100('LENT');

    const over = await postReturn(order, [{ acceptedQuantity: 90, damagedQuantity: 11 }]).expect(409);
    expect(over.body).toMatchObject({
      error: {
        code: 'RETURN_EXCEEDS_OUT',
        details: { lines: [{ orderLineId: lineOf(order), requested: 101, outQuantity: 100 }] },
      },
    });
    const refund = await postReturn(order, [{ acceptedQuantity: 0, damagedQuantity: 2, damagedRefund: 2_001 }]).expect(
      400,
    );
    expect(refund.body).toMatchObject({
      error: { code: 'DAMAGED_REFUND_TOO_HIGH', details: { orderLineId: lineOf(order), maximum: 2_000 } },
    });
    // Q41: an entry that returns nothing is dropped; with nothing left, the return is empty.
    const empty = await postReturn(order, [{ acceptedQuantity: 0, damagedQuantity: 0 }]).expect(400);
    expect(empty.body).toMatchObject({ error: { code: 'RETURN_EMPTY' } });
    const foreign = await postReturn(order, [
      { acceptedQuantity: 1, damagedQuantity: 0, orderLineId: lineOf(other) },
    ]).expect(400);
    expect(foreign.body).toMatchObject({
      error: { code: 'RETURN_LINE_NOT_IN_ORDER', details: { orderLineId: lineOf(other) } },
    });
    const twice = await http()
      .post(`/api/orders/${order.id}/returns`)
      .set(asUser(admin))
      .set('Idempotency-Key', randomUUID())
      .send({
        date: TODAY,
        lines: [
          ...entries(order, [{ acceptedQuantity: 1, damagedQuantity: 0 }]),
          ...entries(order, [{ acceptedQuantity: 1, damagedQuantity: 0 }]),
        ],
      })
      .expect(400);
    expect(twice.body).toMatchObject({
      error: { code: 'RETURN_DUPLICATE_LINE', details: { orderLineId: lineOf(order) } },
    });
    const early = await postReturn(order, [{ acceptedQuantity: 1, damagedQuantity: 0 }], { date: '2026-09-10' }).expect(
      400,
    );
    expect(early.body).toMatchObject({
      error: { code: 'RETURN_DATE_BEFORE_ORDER_DATE', details: { orderDate: TODAY } },
    });
    const future = await postReturn(order, [{ acceptedQuantity: 1, damagedQuantity: 0 }], {
      date: '2026-09-12',
    }).expect(400);
    expect(future.body).toMatchObject({ error: { code: 'BUSINESS_DATE_IN_FUTURE' } });

    await http().post(`/api/orders/${other.id}/cancel`).set(asUser(admin)).send({ version: 1 }).expect(200);
    const cancelled = await postReturn(other, [{ acceptedQuantity: 1, damagedQuantity: 0 }]).expect(409);
    expect(cancelled.body).toMatchObject({ error: { code: 'ORDER_CANCELLED' } });
    const missing = await http()
      .post('/api/orders/999999/returns')
      .set(asUser(admin))
      .set('Idempotency-Key', randomUUID())
      .send({ date: TODAY, lines: entries(order, [{ acceptedQuantity: 1, damagedQuantity: 0 }]) })
      .expect(404);
    expect(missing.body).toMatchObject({ error: { code: 'ORDER_NOT_FOUND' } });

    expect(await prisma.palletReturn.count()).toBe(0);
  });

  it('I8 — two returns racing for the same pallets: the order lock lets one through', async () => {
    const order = await order100('LENT');

    const results = await Promise.all([
      postReturn(order, [{ acceptedQuantity: 60, damagedQuantity: 0 }]),
      postReturn(order, [{ acceptedQuantity: 60, damagedQuantity: 0 }]),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)?.body).toMatchObject({
      error: { code: 'RETURN_EXCEEDS_OUT' },
    });
    expect(await onHand()).toBe(460);
  });

  it('records one return per idempotency key, and a return freezes the order lines', async () => {
    const order = await order100('LENT');
    const key = randomUUID();

    const first = await postReturn(order, [{ acceptedQuantity: 10, damagedQuantity: 0 }], { key }).expect(201);
    const replay = await postReturn(order, [{ acceptedQuantity: 10, damagedQuantity: 0 }], { key }).expect(201);

    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(await prisma.palletReturn.count()).toBe(1);
    const reused = await postReturn(order, [{ acceptedQuantity: 11, damagedQuantity: 0 }], { key }).expect(409);
    expect(reused.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });

    const body = first.body as ReturnResultDto;
    expect(body.order.version).toBe(2);
    expect(body.order.canEditLines).toBe(false);
    const edit = await http()
      .patch(`/api/orders/${order.id}`)
      .set(asUser(admin))
      .send({ version: 2, lines: [{ itemId: item.id, quantity: 90 }] })
      .expect(409);
    expect(edit.body).toMatchObject({ error: { code: 'ORDER_HAS_ACTIVITY', details: { nonReversedReturnCount: 1 } } });
  });

  it('writes the history of a return with its order, and only a permitted user may touch returns', async () => {
    const order = await order100('CASH');
    const recorded = await returnOf(order, [{ acceptedQuantity: 30, damagedQuantity: 5, damagedRefund: 1_000 }]);

    const created = await prisma.auditLog.findFirstOrThrow({ where: { action: 'RETURN_CREATE' } });
    expect(created.entityId).toBe(String(recorded.returnId));
    expect(created.summaryParams).toEqual({
      orderNumber: order.orderNumber,
      accepted: 30,
      damaged: 5,
      refundDue: 31_000,
      cashRefund: 31_000,
    });
    expect(created.after).toMatchObject({
      id: recorded.returnId,
      orderId: order.id,
      date: TODAY,
      refundDue: 31_000,
      owedBefore: 0,
      cashRefund: 31_000,
      lines: [
        {
          orderLineId: lineOf(order),
          itemId: item.id,
          itemName: 'Pallet 120×100',
          acceptedQuantity: 30,
          damagedQuantity: 5,
          unitDeposit: 1_000,
          damagedRefund: 1_000,
        },
      ],
    });
    expect(await prisma.auditLog.count({ where: { action: 'REFUND_CREATE' } })).toBe(1);

    const viewer = await createEmployee(app, ['orders.view', 'returns.create'], 'clerk');
    const clerk = await login(app, viewer.username, EMPLOYEE_PASSWORD);
    await postReturn(order, [{ acceptedQuantity: 1, damagedQuantity: 0 }], { session: clerk }).expect(201);
    await replace(recorded.returnId, order, [{ acceptedQuantity: 1, damagedQuantity: 0 }])
      .set(asUser(clerk))
      .expect(403);
    await remove(recorded.returnId, clerk).expect(403);

    await remove(recorded.returnId).expect(200);
    const deleted = await prisma.auditLog.findFirstOrThrow({ where: { action: 'RETURN_DELETE' } });
    expect(deleted.summaryParams).toEqual({ orderNumber: order.orderNumber });
    expect(deleted.before).toMatchObject({ id: recorded.returnId, orderId: order.id });
    expect(deleted.after).toMatchObject({ reversalKind: 'DELETE', reversedAt: NOW.toISOString() });
  });
});
