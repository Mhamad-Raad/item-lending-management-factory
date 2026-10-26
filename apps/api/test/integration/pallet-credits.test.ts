import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type {
  CustomerDto,
  CustomerReturnResultDto,
  DriverDto,
  ItemDto,
  OrderDetailDto,
  PageDto,
  PalletCreditBalanceDto,
  ReturnListItemDto,
  ReturnReceiptDto,
} from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { createCustomer, createDriver, createItem, createOrder } from '../helpers/factories';

const NOW = new Date('2026-09-11T09:00:00Z');
const TODAY = '2026-09-11';

/** Q170: pallets that come back beyond what was out are owed to the customer, given back, or used by the next order. */
describe('pallets the factory owes a customer (Q170)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;
  let pallet: ItemDto;
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
    pallet = await createItem(app, admin, { name: 'Pallet 120×100', depositPrice: 1_000, stock: 500 });
    customer = await createCustomer(app, admin);
    driver = await createDriver(app, admin);
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const order = (quantity: number, date = '2026-09-10'): Promise<OrderDetailDto> =>
    createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date,
      paymentType: 'LENT',
      lines: [{ itemId: pallet.id, quantity }],
    });
  const back = (orders: { order: OrderDetailDto; accepted: number }[], surplus: number) =>
    http()
      .post(`/api/customers/${customer.id}/returns`)
      .set(asUser(admin))
      .set('Idempotency-Key', randomUUID())
      .send({
        date: TODAY,
        notes: null,
        orders: orders.map(({ order: one, accepted }) => ({
          orderId: one.id,
          lines: [{ orderLineId: one.lines[0]?.id, acceptedQuantity: accepted, damagedQuantity: 0, damagedRefund: 0 }],
        })),
        surplus: surplus > 0 ? [{ itemId: pallet.id, quantity: surplus }] : [],
      });
  const owed = async (): Promise<number> => {
    const rows = (await http().get(`/api/customers/${customer.id}/pallet-credits`).set(asUser(admin)).expect(200))
      .body as PalletCreditBalanceDto[];
    return rows.find((row) => row.item.id === pallet.id)?.quantity ?? 0;
  };
  const onHand = async (): Promise<number> =>
    (await prisma.item.findUniqueOrThrow({ where: { id: pallet.id } })).quantityOnHand;

  it('takes more than was out only once every pallet of the type is back, and owes the rest', async () => {
    const first = await order(10);
    const second = await order(5);
    // 8 still out on the second order: what is out elsewhere comes back first.
    const refused = await back([{ order: first, accepted: 10 }], 2).expect(409);
    expect(refused.body).toMatchObject({ error: { code: 'PALLET_SURPLUS_STILL_OUT', details: { outQuantity: 5 } } });

    const stockBefore = await onHand();
    const result = (
      await back(
        [
          { order: first, accepted: 10 },
          { order: second, accepted: 5 },
        ],
        2,
      ).expect(201)
    ).body as CustomerReturnResultDto;
    expect(result.surplus).toEqual([{ item: expect.objectContaining({ id: pallet.id }) as unknown, quantity: 2 }]);
    expect(await owed()).toBe(2);
    // All 17 went into stock; only the 15 that were out are credited at their deposit.
    expect((await onHand()) - stockBefore).toBe(17);

    const receipt = (
      await http().get(`/api/returns/${result.returns[1]?.returnId}/receipt`).set(asUser(admin)).expect(200)
    ).body as ReturnReceiptDto;
    expect(receipt.lines).toEqual([expect.objectContaining({ accepted: 5, extra: 2, withCustomer: 0 })]);
  });

  it('gives back no more than is owed, and refuses to take back a return whose surplus went back', async () => {
    const first = await order(10);
    const result = (await back([{ order: first, accepted: 10 }], 3).expect(201)).body as CustomerReturnResultDto;
    const giveBack = (quantity: number) =>
      http()
        .post(`/api/customers/${customer.id}/pallet-credits/hand-back`)
        .set(asUser(admin))
        .set('Idempotency-Key', randomUUID())
        .send({ itemId: pallet.id, quantity, date: TODAY });

    const over = await giveBack(4).expect(409);
    expect(over.body).toMatchObject({ error: { code: 'PALLET_CREDIT_INSUFFICIENT', details: { available: 3 } } });
    await giveBack(1).expect(201);
    expect(await owed()).toBe(2);

    const returnId = result.returns[0]?.returnId;
    const refused = await http().delete(`/api/returns/${returnId}`).set(asUser(admin)).expect(409);
    expect(refused.body).toMatchObject({ error: { code: 'PALLET_CREDIT_GIVEN_BACK' } });
  });

  it('takes a visit’s surplus back when any of its returns of that type is deleted', async () => {
    const first = await order(5);
    const second = await order(5);
    const result = (
      await back(
        [
          { order: first, accepted: 5 },
          { order: second, accepted: 5 },
        ],
        2,
      ).expect(201)
    ).body as CustomerReturnResultDto;
    // The surplus stands on the second order's return; deleting the first's puts 5 out again, so it goes.
    const firstReturn = result.returns.find((entry) => entry.orderId === first.id)?.returnId;
    await http().delete(`/api/returns/${firstReturn}`).set(asUser(admin)).expect(200);
    expect(await owed()).toBe(0);
  });

  it('lets the next order take what is owed first, without deposit, and a cancel owes it again', async () => {
    const first = await order(10);
    await back([{ order: first, accepted: 10 }], 2).expect(201);
    const stockBefore = await onHand();

    const allFromCredit = await http()
      .post('/api/orders')
      .set(asUser(admin))
      .set('Idempotency-Key', randomUUID())
      .send({
        customerId: customer.id,
        driverId: driver.id,
        date: TODAY,
        paymentType: 'LENT',
        lines: [{ itemId: pallet.id, quantity: 2 }],
      })
      .expect(409);
    expect(allFromCredit.body).toMatchObject({ error: { code: 'ORDER_ALL_FROM_CREDIT' } });

    const next = await order(5, TODAY);
    expect(next.lines[0]?.quantity).toBe(3);
    expect(next.depositTotal).toBe(3_000);
    expect(next.fromCredit).toEqual([{ item: expect.objectContaining({ id: pallet.id }) as unknown, quantity: 2 }]);
    expect(await owed()).toBe(0);
    expect(stockBefore - (await onHand())).toBe(5);

    await http().post(`/api/orders/${next.id}/cancel`).set(asUser(admin)).send({ version: next.version }).expect(200);
    expect(await owed()).toBe(2);
    expect(await onHand()).toBe(stockBefore);
  });

  it('lists every return newest first, filtered by order', async () => {
    const first = await order(10);
    const second = await order(10);
    await back([{ order: first, accepted: 4 }], 0).expect(201);
    await back([{ order: second, accepted: 6 }], 0).expect(201);
    const list = (await http().get('/api/returns').set(asUser(admin)).expect(200)).body as PageDto<ReturnListItemDto>;
    expect(list.items.map((row) => row.accepted)).toEqual([6, 4]);
    const filtered = (await http().get(`/api/returns?orderId=${first.id}`).set(asUser(admin)).expect(200))
      .body as PageDto<ReturnListItemDto>;
    expect(filtered.items.map((row) => row.orderId)).toEqual([first.id]);
  });

  it('refuses to delete a return whose surplus went out first, though a later surplus stands', async () => {
    const first = await order(10);
    const one = (await back([{ order: first, accepted: 10 }], 5).expect(201)).body as CustomerReturnResultDto;
    await http()
      .post(`/api/customers/${customer.id}/pallet-credits/hand-back`)
      .set(asUser(admin))
      .set('Idempotency-Key', randomUUID())
      .send({ itemId: pallet.id, quantity: 5, date: TODAY })
      .expect(201);
    const second = await order(10);
    await back([{ order: second, accepted: 10 }], 5).expect(201);
    expect(await owed()).toBe(5);
    // The first return's 5 went back already: deleting it must not spend the second return's credit.
    const refused = await http().delete(`/api/returns/${one.returns[0]?.returnId}`).set(asUser(admin)).expect(409);
    expect(refused.body).toMatchObject({ error: { code: 'PALLET_CREDIT_GIVEN_BACK' } });
    expect(await owed()).toBe(5);
  });

  it('keeps a surplus through a correction, and refuses one that puts pallets out again', async () => {
    const first = await order(10);
    const result = (await back([{ order: first, accepted: 10 }], 2).expect(201)).body as CustomerReturnResultDto;
    const returnId = result.returns[0]?.returnId;
    const correct = (accepted: number) =>
      http()
        .post(`/api/returns/${returnId}/replace`)
        .set(asUser(admin))
        .send({
          date: TODAY,
          notes: 'Counted again',
          lines: [
            { orderLineId: first.lines[0]?.id, acceptedQuantity: accepted, damagedQuantity: 0, damagedRefund: 0 },
          ],
        });
    const refused = await correct(8).expect(409);
    expect(refused.body).toMatchObject({ error: { code: 'PALLET_SURPLUS_STILL_OUT', details: { outQuantity: 2 } } });
    await correct(10).expect(201);
    expect(await owed()).toBe(2);
  });

  it('gives back once for one key, however often it is sent', async () => {
    const first = await order(10);
    await back([{ order: first, accepted: 10 }], 4).expect(201);
    const key = randomUUID();
    const send = () =>
      http()
        .post(`/api/customers/${customer.id}/pallet-credits/hand-back`)
        .set(asUser(admin))
        .set('Idempotency-Key', key)
        .send({ itemId: pallet.id, quantity: 1, date: TODAY })
        .expect(201);
    await send();
    const again = await send();
    expect(again.headers['idempotency-replayed']).toBe('true');
    expect(await owed()).toBe(3);
  });

  it('narrows a customer filter by a name search, never widens it', async () => {
    const other = await createCustomer(app, admin, { name: 'Another Customer', phone: '07509998877' });
    const first = await order(10);
    await back([{ order: first, accepted: 4 }], 0).expect(201);
    const theirs = await createOrder(app, admin, {
      customerId: other.id,
      driverId: driver.id,
      date: '2026-09-10',
      paymentType: 'LENT',
      lines: [{ itemId: pallet.id, quantity: 5 }],
    });
    await http()
      .post(`/api/customers/${other.id}/returns`)
      .set(asUser(admin))
      .set('Idempotency-Key', randomUUID())
      .send({
        date: TODAY,
        notes: null,
        orders: [
          {
            orderId: theirs.id,
            lines: [{ orderLineId: theirs.lines[0]?.id, acceptedQuantity: 5, damagedQuantity: 0, damagedRefund: 0 }],
          },
        ],
      })
      .expect(201);
    const list = (await http().get(`/api/returns?customerId=${customer.id}&q=Another`).set(asUser(admin)).expect(200))
      .body as PageDto<ReturnListItemDto>;
    expect(list.items).toEqual([]);
  });

  it('owes again what an edit takes off the order, and refuses putting out a type still owed', async () => {
    const other = await createItem(app, admin, { name: 'Crate', depositPrice: 500, stock: 500 });
    const first = await order(10);
    await back([{ order: first, accepted: 10 }], 2).expect(201);
    const next = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: TODAY,
      paymentType: 'LENT',
      lines: [
        { itemId: pallet.id, quantity: 5 },
        { itemId: other.id, quantity: 1 },
      ],
    });
    expect(await owed()).toBe(0);
    // The pallets never went out: taken off the order, the 2 it took of what was owed are owed again.
    await http()
      .patch(`/api/orders/${next.id}`)
      .set(asUser(admin))
      .send({ version: next.version, lines: [{ itemId: other.id, quantity: 1 }] })
      .expect(200);
    expect(await owed()).toBe(2);
  });

  it('refuses to delete an earlier return while a later one keeps pallets of that type owed', async () => {
    const first = await order(10);
    const r1 = (await back([{ order: first, accepted: 10 }], 0).expect(201)).body as CustomerReturnResultDto;
    const second = await order(5);
    await back([{ order: second, accepted: 5 }], 3).expect(201);
    expect(await owed()).toBe(3);
    const refused = await http().delete(`/api/returns/${r1.returns[0]?.returnId}`).set(asUser(admin)).expect(409);
    expect(refused.body).toMatchObject({
      error: { code: 'PALLET_CREDIT_OUTSTANDING', details: { owed: 3, outQuantity: 10 } },
    });
  });

  it('leaves a type wholly given from what was owed alone when another line is edited', async () => {
    const other = await createItem(app, admin, { name: 'Crate', depositPrice: 500, stock: 500 });
    const first = await order(10);
    await back([{ order: first, accepted: 10 }], 2).expect(201);
    const next = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: TODAY,
      paymentType: 'LENT',
      lines: [
        { itemId: pallet.id, quantity: 2 },
        { itemId: other.id, quantity: 1 },
      ],
    });
    expect(next.lines.map((line) => line.item.id)).toEqual([other.id]);
    const stock = await onHand();
    await http()
      .patch(`/api/orders/${next.id}`)
      .set(asUser(admin))
      .send({ version: next.version, lines: [{ itemId: other.id, quantity: 2 }] })
      .expect(200);
    // The 2 owed pallets went out with the order: nothing is owed again and no pallet comes back.
    expect(await owed()).toBe(0);
    expect(await onHand()).toBe(stock);
  });

  it('cancels an order that used what was owed even after a later order lent the same type', async () => {
    const first = await order(10);
    await back([{ order: first, accepted: 10 }], 2).expect(201);
    const used = await order(5, TODAY);
    await order(4, TODAY);
    await http().post(`/api/orders/${used.id}/cancel`).set(asUser(admin)).send({ version: used.version }).expect(200);
    expect(await owed()).toBe(2);
  });

  it('finds a visit’s surplus on a corrected part when another part is deleted', async () => {
    const first = await order(5);
    const second = await order(5);
    const result = (
      await back(
        [
          { order: first, accepted: 5 },
          { order: second, accepted: 5 },
        ],
        2,
      ).expect(201)
    ).body as CustomerReturnResultDto;
    const onSecond = result.returns.find((entry) => entry.orderId === second.id)?.returnId;
    await http()
      .post(`/api/returns/${onSecond}/replace`)
      .set(asUser(admin))
      .send({
        date: TODAY,
        notes: 'Counted again',
        lines: [{ orderLineId: second.lines[0]?.id, acceptedQuantity: 5, damagedQuantity: 0, damagedRefund: 0 }],
      })
      .expect(201);
    const onFirst = result.returns.find((entry) => entry.orderId === first.id)?.returnId;
    await http().delete(`/api/returns/${onFirst}`).set(asUser(admin)).expect(200);
    expect(await owed()).toBe(0);
  });

  it('finds the visit through a corrected part, so deleting that correction takes the surplus back', async () => {
    const first = await order(5);
    const second = await order(5);
    const result = (
      await back(
        [
          { order: first, accepted: 5 },
          { order: second, accepted: 5 },
        ],
        2,
      ).expect(201)
    ).body as CustomerReturnResultDto;
    const onFirst = result.returns.find((entry) => entry.orderId === first.id)?.returnId;
    const corrected = await http()
      .post(`/api/returns/${onFirst}/replace`)
      .set(asUser(admin))
      .send({
        date: TODAY,
        notes: 'Counted again',
        lines: [{ orderLineId: first.lines[0]?.id, acceptedQuantity: 5, damagedQuantity: 0, damagedRefund: 0 }],
      })
      .expect(201);
    const replacement = (corrected.body as { returnId: number }).returnId;
    await http().delete(`/api/returns/${replacement}`).set(asUser(admin)).expect(200);
    expect(await owed()).toBe(0);
  });

  it('writes a give-back to the history as given back', async () => {
    const first = await order(10);
    await back([{ order: first, accepted: 10 }], 2).expect(201);
    await http()
      .post(`/api/customers/${customer.id}/pallet-credits/hand-back`)
      .set(asUser(admin))
      .set('Idempotency-Key', randomUUID())
      .send({ itemId: pallet.id, quantity: 1, date: TODAY })
      .expect(201);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'PALLET_CREDIT', action: 'HAND_BACK' } });
    expect(row.entityId).not.toBeNull();
  });

  it("lists what is owed and given back on the customer's timeline", async () => {
    const first = await order(10);
    await back([{ order: first, accepted: 10 }], 2).expect(201);
    await http()
      .post(`/api/customers/${customer.id}/pallet-credits/hand-back`)
      .set(asUser(admin))
      .set('Idempotency-Key', randomUUID())
      .send({ itemId: pallet.id, quantity: 1, date: TODAY, note: 'Collected by the driver' })
      .expect(201);
    const timeline = (
      await http().get(`/api/customers/${customer.id}/history?kinds=PALLET`).set(asUser(admin)).expect(200)
    ).body as PageDto<{ kind: string; reason: string; quantity: number; note: string | null }>;
    expect(timeline.items.map(({ reason, quantity, note }) => ({ reason, quantity, note }))).toEqual([
      { reason: 'HAND_BACK', quantity: -1, note: 'Collected by the driver' },
      { reason: 'RETURN_SURPLUS', quantity: 2, note: null },
    ]);
  });

  it('prints a give-back with what was owed before and after it, as it stood then', async () => {
    const first = await order(10);
    await back([{ order: first, accepted: 10 }], 3).expect(201);
    const given = await http()
      .post(`/api/customers/${customer.id}/pallet-credits/hand-back`)
      .set(asUser(admin))
      .set('Idempotency-Key', randomUUID())
      .send({ itemId: pallet.id, quantity: 2, date: TODAY })
      .expect(201);
    const { palletCreditId } = given.body as { palletCreditId: number };
    const paper = (await http().get(`/api/hand-backs/${palletCreditId}/receipt`).set(asUser(admin)).expect(200))
      .body as { quantity: number; owedBefore: number; owedAfter: number; receiptNumberDisplay: string };
    expect(paper).toMatchObject({
      quantity: 2,
      owedBefore: 3,
      owedAfter: 1,
      // Numbered among the give-backs alone: this is the first.
      receiptNumberDisplay: '000001',
    });
    // Only a give-back has a paper.
    await http()
      .get(`/api/hand-backs/${palletCreditId - 1}/receipt`)
      .set(asUser(admin))
      .expect(404);
  });

  it('undoes a give-back once: owed again, the pallets back in stock, its paper stamped', async () => {
    const first = await order(10);
    await back([{ order: first, accepted: 10 }], 3).expect(201);
    const given = await http()
      .post(`/api/customers/${customer.id}/pallet-credits/hand-back`)
      .set(asUser(admin))
      .set('Idempotency-Key', randomUUID())
      .send({ itemId: pallet.id, quantity: 3, date: TODAY })
      .expect(201);
    const { palletCreditId } = given.body as { palletCreditId: number };
    const stock = await onHand();
    await http().post(`/api/hand-backs/${palletCreditId}/undo`).set(asUser(admin)).expect(204);
    expect(await owed()).toBe(3);
    expect((await onHand()) - stock).toBe(3);
    // Undoing it again — a retry after a lost answer — changes nothing and is no error.
    await http().post(`/api/hand-backs/${palletCreditId}/undo`).set(asUser(admin)).expect(204);
    expect(await owed()).toBe(3);
    const paper = (await http().get(`/api/hand-backs/${palletCreditId}/receipt`).set(asUser(admin)).expect(200))
      .body as { reversedOn: string | null; receiptNumberDisplay: string };
    expect(paper).toMatchObject({ reversedOn: TODAY, receiptNumberDisplay: '000001' });
    const timeline = (
      await http().get(`/api/customers/${customer.id}/history?kinds=PALLET`).set(asUser(admin)).expect(200)
    ).body as PageDto<{ reason: string; undone: boolean }>;
    expect(timeline.items.find((item) => item.reason === 'HAND_BACK')?.undone).toBe(true);
  });

  it("hides a cancelled order's owed-pallet entries with the order on the timeline", async () => {
    const first = await order(10);
    await back([{ order: first, accepted: 10 }], 2).expect(201);
    const used = await order(5, TODAY);
    await http().post(`/api/orders/${used.id}/cancel`).set(asUser(admin)).send({ version: used.version }).expect(200);
    const reasons = (path: string) =>
      http()
        .get(path)
        .set(asUser(admin))
        .expect(200)
        .then((response) => (response.body as PageDto<{ reason: string }>).items.map((item) => item.reason));
    expect(await reasons(`/api/customers/${customer.id}/history?kinds=PALLET`)).toEqual(['RETURN_SURPLUS']);
    expect((await reasons(`/api/customers/${customer.id}/history?kinds=PALLET&includeCancelled=true`)).sort()).toEqual([
      'ORDER_CANCEL',
      'ORDER_USE',
      'RETURN_SURPLUS',
    ]);
  });

  it('writes a history row for the extra pallets of a return over several orders too', async () => {
    const first = await order(5);
    const second = await order(5);
    await back(
      [
        { order: first, accepted: 5 },
        { order: second, accepted: 5 },
      ],
      2,
    ).expect(201);
    const rows = await prisma.auditLog.count({ where: { entityType: 'PALLET_CREDIT', action: 'CREATE' } });
    expect(rows).toBe(1);
  });

  it('refuses to undo a give-back while the customer has that type out since', async () => {
    const first = await order(10);
    await back([{ order: first, accepted: 10 }], 2).expect(201);
    const given = await http()
      .post(`/api/customers/${customer.id}/pallet-credits/hand-back`)
      .set(asUser(admin))
      .set('Idempotency-Key', randomUUID())
      .send({ itemId: pallet.id, quantity: 2, date: TODAY })
      .expect(201);
    await order(4, TODAY);
    const refused = await http()
      .post(`/api/hand-backs/${(given.body as { palletCreditId: number }).palletCreditId}/undo`)
      .set(asUser(admin))
      .expect(409);
    expect(refused.body).toMatchObject({ error: { code: 'HAND_BACK_UNDO_WHILE_OUT', details: { outQuantity: 4 } } });
    expect(await owed()).toBe(0);
  });
});
