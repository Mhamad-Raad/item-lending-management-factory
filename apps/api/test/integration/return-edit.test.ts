import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type {
  CustomerDto,
  CustomerReturnEditableDto,
  CustomerReturnResultDto,
  CustomerReturnableDto,
  DriverDto,
  ItemDto,
  OrderDetailDto,
  PalletCreditBalanceDto,
} from '@pallet/shared';
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
} from '../helpers/factories';

const NOW = new Date('2026-09-11T09:00:00Z');
const TODAY = '2026-09-11';

type Back = { order: OrderDetailDto; accepted: number; damaged?: number };

/** Q174: a return edited from the returns list, on the customer screen — a visit over several orders whole. */
describe('editing a return from the returns list (Q174)', () => {
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
  // Paid in cash, so a return pays deposit back and an edit moves cash.
  const order = (quantity: number, date = '2026-09-10'): Promise<OrderDetailDto> =>
    createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date,
      paymentType: 'CASH',
      lines: [{ itemId: pallet.id, quantity }],
    });
  const body = (orders: Back[], surplus = 0, notes: string | null = null) => ({
    date: TODAY,
    notes,
    orders: orders.map(({ order: one, accepted, damaged = 0 }) => ({
      orderId: one.id,
      lines: [
        { orderLineId: one.lines[0]?.id, acceptedQuantity: accepted, damagedQuantity: damaged, damagedRefund: 0 },
      ],
    })),
    surplus: surplus > 0 ? [{ itemId: pallet.id, quantity: surplus }] : [],
  });
  const back = async (orders: Back[], surplus = 0): Promise<CustomerReturnResultDto> =>
    (
      await http()
        .post(`/api/customers/${customer.id}/returns`)
        .set(asUser(admin))
        .set('Idempotency-Key', randomUUID())
        .send(body(orders, surplus))
        .expect(201)
    ).body as CustomerReturnResultDto;
  const editable = async (returnId: number): Promise<CustomerReturnEditableDto> =>
    (await http().get(`/api/returns/${returnId}/editable`).set(asUser(admin)).expect(200))
      .body as CustomerReturnEditableDto;
  // `reopened`: the extra pallets the screen counted as still owed when it opened.
  const edit = (returnId: number, orders: Back[], surplus = 0, notes: string | null = null, reopened = 0) =>
    http()
      .post(`/api/returns/${returnId}/replace-customer`)
      .set(asUser(admin))
      .send({
        ...body(orders, surplus, notes),
        reopened: reopened > 0 ? [{ itemId: pallet.id, quantity: reopened }] : [],
      });
  const outOf = async (orderId: number): Promise<number> =>
    (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).outQuantityTotal;
  const owed = async (): Promise<number> => {
    const rows = (await http().get(`/api/customers/${customer.id}/pallet-credits`).set(asUser(admin)).expect(200))
      .body as PalletCreditBalanceDto[];
    return rows.find((row) => row.item.id === pallet.id)?.quantity ?? 0;
  };
  const onHand = async (): Promise<number> =>
    (await prisma.item.findUniqueOrThrow({ where: { id: pallet.id } })).quantityOnHand;
  const cashOut = async (): Promise<number> => {
    // Cash paid back, net of the refunds reversed.
    const rows = await prisma.ledgerEntry.findMany({ where: { type: { in: ['REFUND', 'REFUND_REVERSAL'] } } });
    return rows.reduce((total, row) => total + (row.type === 'REFUND' ? 1 : -1) * Number(row.amount), 0);
  };

  it('shows a visit as if it had never been recorded, with its counts by item and the cash it paid', async () => {
    const first = await order(10);
    const second = await order(6);
    const visit = await back([
      { order: first, accepted: 4 },
      { order: second, accepted: 2 },
    ]);
    const [part] = visit.returns;

    const view = await editable(part?.returnId ?? 0);
    expect(view.customerReturnId).toBe(visit.customerReturnId);
    expect(view.date).toBe(TODAY);
    expect(view.items).toEqual([{ itemId: pallet.id, accepted: 6, damaged: 0, damagedRefund: 0 }]);
    expect(view.cashRefunded).toBe(6_000);
    // Every pallet of both orders is out again on the screen.
    expect(view.orders.map((one) => [one.id, one.outQuantityTotal])).toEqual([
      [first.id, 10],
      [second.id, 6],
    ]);
    // Nothing changed meanwhile: the customer screen still sees the return.
    const now = (await http().get(`/api/customers/${customer.id}/returnable`).set(asUser(admin)).expect(200))
      .body as CustomerReturnableDto;
    expect(now.orders.map((one) => one.outQuantityTotal)).toEqual([6, 4]);
  });

  it('replaces a visit whole: each part corrected, one visit again, stock and cash moved by the difference', async () => {
    const first = await order(10);
    const second = await order(6);
    const visit = await back([
      { order: first, accepted: 4 },
      { order: second, accepted: 2 },
    ]);
    const stockBefore = await onHand();
    const cashBefore = await cashOut();

    const result = (
      await edit(
        visit.returns[1]?.returnId ?? 0,
        [
          { order: first, accepted: 3 },
          { order: second, accepted: 5 },
        ],
        0,
        'counted again',
      ).expect(201)
    ).body as CustomerReturnResultDto;

    expect(result.customerReturnId).not.toBeNull();
    expect(result.customerReturnId).not.toBe(visit.customerReturnId);
    expect(result.returns.map((entry) => [entry.orderId, entry.accepted, entry.cashRefund])).toEqual([
      [first.id, 3, 3_000],
      [second.id, 5, 5_000],
    ]);
    expect(await outOf(first.id)).toBe(7);
    expect(await outOf(second.id)).toBe(1);
    expect((await onHand()) - stockBefore).toBe(2);
    // The old refunds reversed, the new ones written: 2,000 more went out in all.
    expect((await cashOut()) - cashBefore).toBe(2_000);
    expect(await prisma.ledgerEntry.count({ where: { type: 'REFUND_REVERSAL' } })).toBe(2);

    const olds = await prisma.palletReturn.findMany({
      where: { id: { in: visit.returns.map((entry) => entry.returnId) } },
      orderBy: { id: 'asc' },
    });
    expect(olds.map((pr) => [pr.reversalKind, pr.replacedByReturnId])).toEqual([
      ['EDIT', result.returns[0]?.returnId],
      ['EDIT', result.returns[1]?.returnId],
    ]);
    const news = await prisma.palletReturn.findMany({
      where: { id: { in: result.returns.map((entry) => entry.returnId) } },
    });
    expect(news.every((pr) => pr.notes === 'counted again' && pr.customerReturnId === result.customerReturnId)).toBe(
      true,
    );
    // One history row for the whole edit, as for the visit it replaced (Q161): the parts' and refunds' rows are in it.
    const rows = await prisma.auditLog.findMany({ where: { action: { in: ['RETURN_EDIT', 'RETURN_CREATE'] } } });
    expect(rows.filter((row) => row.action === 'RETURN_EDIT').map((row) => [row.entityType, row.entityId])).toEqual([
      ['CUSTOMER_RETURN', String(result.customerReturnId)],
    ]);
    expect(await prisma.auditLog.count({ where: { action: { in: ['REFUND_CREATE', 'REFUND_REVERSE'] } } })).toBe(0);
    // That row holds the refunds reversed and paid, and names the customer, whom it links to.
    const row = rows.find((entry) => entry.action === 'RETURN_EDIT');
    expect(row?.before).toMatchObject({ customerId: customer.id });
    expect(row?.after).toMatchObject({
      customerId: customer.id,
      returns: [
        { refund: expect.objectContaining({ amount: 3_000 }) as unknown, refundReversal: expect.anything() as unknown },
        { refund: expect.objectContaining({ amount: 5_000 }) as unknown, refundReversal: expect.anything() as unknown },
      ],
    });

    // A repeat finds the old return reversed.
    const again = await edit(visit.returns[0]?.returnId ?? 0, [{ order: first, accepted: 1 }]).expect(409);
    expect(again.body).toMatchObject({ error: { code: 'RETURN_ALREADY_REVERSED' } });
    await http().get(`/api/returns/${visit.returns[0]?.returnId}/editable`).set(asUser(admin)).expect(409);
  });

  it('deletes a part whose order takes nothing now, and names a new order, no visit for one order', async () => {
    const first = await order(10);
    const second = await order(6);
    const third = await order(4);
    const visit = await back([
      { order: first, accepted: 4 },
      { order: second, accepted: 2 },
    ]);

    const moved = (await edit(visit.returns[0]?.returnId ?? 0, [{ order: third, accepted: 4 }]).expect(201))
      .body as CustomerReturnResultDto;
    expect(moved.customerReturnId).toBeNull();
    expect(moved.returns.map((entry) => entry.orderId)).toEqual([third.id]);
    expect([await outOf(first.id), await outOf(second.id), await outOf(third.id)]).toEqual([10, 6, 0]);
    const olds = await prisma.palletReturn.findMany({
      where: { id: { in: visit.returns.map((entry) => entry.returnId) } },
    });
    expect(olds.map((pr) => [pr.reversalKind, pr.replacedByReturnId])).toEqual([
      ['DELETE', null],
      ['DELETE', null],
    ]);
  });

  it('edits a return on one order, as one', async () => {
    const first = await order(10);
    const single = await back([{ order: first, accepted: 4 }]);
    const view = await editable(single.returns[0]?.returnId ?? 0);
    expect(view.customerReturnId).toBeNull();
    expect(view.items).toEqual([{ itemId: pallet.id, accepted: 4, damaged: 0, damagedRefund: 0 }]);

    const result = (
      await edit(single.returns[0]?.returnId ?? 0, [{ order: first, accepted: 2, damaged: 1 }]).expect(201)
    ).body as CustomerReturnResultDto;
    expect(result.customerReturnId).toBeNull();
    expect(await outOf(first.id)).toBe(7);
  });

  it('refuses more than is out without the return, an order of another customer, and nothing back', async () => {
    const first = await order(10);
    const single = await back([{ order: first, accepted: 4 }]);
    const returnId = single.returns[0]?.returnId ?? 0;

    const over = await edit(returnId, [{ order: first, accepted: 11 }]).expect(409);
    expect(over.body).toMatchObject({ error: { code: 'RETURN_EXCEEDS_OUT' } });

    const other = await createCustomer(app, admin, { name: 'Other customer', phone: '07501112233', confirm: true });
    const theirs = await createOrder(app, admin, {
      customerId: other.id,
      driverId: driver.id,
      lines: [{ itemId: pallet.id, quantity: 3 }],
    });
    const foreign = await edit(returnId, [{ order: theirs, accepted: 1 }]).expect(404);
    expect(foreign.body).toMatchObject({ error: { code: 'ORDER_NOT_FOUND' } });

    await edit(returnId, []).expect(400);
    // Nothing written by the refusals.
    expect(await outOf(first.id)).toBe(6);
    expect((await prisma.palletReturn.findUniqueOrThrow({ where: { id: returnId } })).reversedAt).toBeNull();
  });

  it('keeps extra pallets already given back, and reopens only what is still owed', async () => {
    const first = await order(10);
    const single = await back([{ order: first, accepted: 10 }], 3);
    const returnId = single.returns[0]?.returnId ?? 0;
    await http()
      .post(`/api/customers/${customer.id}/pallet-credits/hand-back`)
      .set(asUser(admin))
      .set('Idempotency-Key', randomUUID())
      .send({ itemId: pallet.id, quantity: 1, date: TODAY })
      .expect(201);
    expect(await owed()).toBe(2);

    // 10 back and the 2 still owed; the one given back stays given back.
    const view = await editable(returnId);
    expect(view.items).toEqual([{ itemId: pallet.id, accepted: 12, damaged: 0, damagedRefund: 0 }]);

    await edit(returnId, [{ order: first, accepted: 10 }], 1, null, 2).expect(201);
    expect(await owed()).toBe(1);

    // Some back out again: no extra while pallets of the type are out.
    const corrected = (await prisma.palletReturn.findFirstOrThrow({ where: { reversedAt: null } })).id;
    const still = await edit(corrected, [{ order: first, accepted: 9 }], 1, null, 1).expect(409);
    expect(still.body).toMatchObject({ error: { code: 'PALLET_SURPLUS_STILL_OUT' } });
    await edit(corrected, [{ order: first, accepted: 9 }], 0, null, 1).expect(201);
    expect(await owed()).toBe(0);
    expect(await outOf(first.id)).toBe(1);
  });

  it('keeps its extra pallets through one stock call: an edit of the notes is never refused for stock', async () => {
    const first = await order(10);
    const single = await back([{ order: first, accepted: 10 }], 2);
    // Every pallet on hand lent out to another customer: none left in stock.
    const other = await createCustomer(app, admin, { name: 'Other customer', phone: '07501112244', confirm: true });
    await createOrder(app, admin, {
      customerId: other.id,
      driverId: driver.id,
      lines: [{ itemId: pallet.id, quantity: await onHand() }],
    });
    expect(await onHand()).toBe(0);

    await edit(single.returns[0]?.returnId ?? 0, [{ order: first, accepted: 10 }], 2, 'only the notes', 2).expect(201);
    // Carried over unchanged, the extra says nothing new on the customer's history.
    expect(await prisma.auditLog.count({ where: { entityType: 'PALLET_CREDIT', action: 'CREATE' } })).toBe(1);
    expect(await owed()).toBe(2);
    expect(await onHand()).toBe(0);
  });

  it('refuses an extra of an item it does not take back', async () => {
    const first = await order(10);
    const single = await back([{ order: first, accepted: 4 }]);
    const crate = await createItem(app, admin, { name: 'Crate', depositPrice: 500, stock: 10 });
    const refused = await http()
      .post(`/api/returns/${single.returns[0]?.returnId}/replace-customer`)
      .set(asUser(admin))
      .send({ ...body([{ order: first, accepted: 4 }]), surplus: [{ itemId: crate.id, quantity: 1 }] })
      .expect(422);
    expect(refused.body).toMatchObject({
      error: { code: 'PALLET_SURPLUS_NOT_RETURNED', details: { itemId: crate.id } },
    });
  });

  it('takes a part off an order only with the right to delete returns', async () => {
    const first = await order(10);
    const second = await order(6);
    const visit = await back([
      { order: first, accepted: 4 },
      { order: second, accepted: 2 },
    ]);
    const returnId = visit.returns[0]?.returnId ?? 0;
    const editor = await createEmployee(app, ['orders.view', 'returns.create', 'returns.edit'], 'editor');
    const session = await login(app, editor.username, EMPLOYEE_PASSWORD);
    const only = (on: Session) =>
      http()
        .post(`/api/returns/${returnId}/replace-customer`)
        .set(asUser(on))
        .send(body([{ order: first, accepted: 5 }]));

    const refused = await only(session).expect(403);
    expect(refused.body).toMatchObject({
      error: { code: 'PERMISSION_DENIED', details: { required: ['returns.delete'] } },
    });
    expect(await outOf(second.id)).toBe(4);
    // Both orders still taking some back is an edit, which the editor may make.
    await http()
      .post(`/api/returns/${returnId}/replace-customer`)
      .set(asUser(session))
      .send(
        body([
          { order: first, accepted: 5 },
          { order: second, accepted: 1 },
        ]),
      )
      .expect(201);
  });

  it('turns good pallets damaged with no stock to spare: the extra they become is judged in the same stock call', async () => {
    const first = await order(10);
    const single = await back([{ order: first, accepted: 10 }]);
    const other = await createCustomer(app, admin, { name: 'Other customer', phone: '07501112255', confirm: true });
    await createOrder(app, admin, {
      customerId: other.id,
      driverId: driver.id,
      lines: [{ itemId: pallet.id, quantity: (await onHand()) - 3 }],
    });
    expect(await onHand()).toBe(3);

    // 5 of the 10 were damaged: the 10 still came in, 5 good and 5 damaged, and 5 more good came over — 15 in all.
    await edit(single.returns[0]?.returnId ?? 0, [{ order: first, accepted: 5, damaged: 5 }], 5).expect(201);
    expect(await onHand()).toBe(3);
    expect(await owed()).toBe(5);
  });

  it('dates the extra pallets taken back on the day of the edit, as a deletion does', async () => {
    const first = await order(10, '2026-09-01');
    const single = (
      await http()
        .post(`/api/customers/${customer.id}/returns`)
        .set(asUser(admin))
        .set('Idempotency-Key', randomUUID())
        .send({ ...body([{ order: first, accepted: 10 }], 2), date: '2026-09-05' })
        .expect(201)
    ).body as CustomerReturnResultDto;
    await http()
      .post(`/api/returns/${single.returns[0]?.returnId}/replace-customer`)
      .set(asUser(admin))
      .send({
        ...body([{ order: first, accepted: 10 }], 1),
        date: '2026-09-05',
        reopened: [{ itemId: pallet.id, quantity: 2 }],
      })
      .expect(201);
    const reversal = await prisma.palletCredit.findFirstOrThrow({ where: { reason: 'RETURN_REVERSAL' } });
    expect(reversal.date.toISOString().slice(0, 10)).toBe(TODAY);
  });

  it('refuses a save after extra pallets it reopened were given back since the screen opened', async () => {
    const first = await order(10);
    const single = await back([{ order: first, accepted: 10 }], 5);
    const returnId = single.returns[0]?.returnId ?? 0;
    expect((await editable(returnId)).reopened).toEqual([{ itemId: pallet.id, quantity: 5 }]);
    // Given back while the screen is open.
    await http()
      .post(`/api/customers/${customer.id}/pallet-credits/hand-back`)
      .set(asUser(admin))
      .set('Idempotency-Key', randomUUID())
      .send({ itemId: pallet.id, quantity: 2, date: TODAY })
      .expect(201);

    const refused = await edit(returnId, [{ order: first, accepted: 10 }], 5, null, 5).expect(409);
    expect(refused.body).toMatchObject({ error: { code: 'PALLET_CREDIT_GIVEN_BACK', details: { available: 3 } } });
    expect(await owed()).toBe(3);
  });

  it('a return on one order made over several keeps its own history row beside the edit’s', async () => {
    const first = await order(10);
    const second = await order(6);
    const single = await back([{ order: first, accepted: 4 }]);
    const returnId = single.returns[0]?.returnId ?? 0;
    const counted = { where: { action: { in: ['RETURN_CREATE' as const, 'REFUND_CREATE' as const] } } };
    const before = await prisma.auditLog.count(counted);
    const result = (
      await edit(returnId, [
        { order: first, accepted: 4 },
        { order: second, accepted: 2 },
      ]).expect(201)
    ).body as CustomerReturnResultDto;

    const rows = await prisma.auditLog.findMany({ where: { action: 'RETURN_EDIT' }, orderBy: { id: 'asc' } });
    expect(rows.map((row) => [row.entityType, row.entityId])).toEqual([
      ['RETURN', String(returnId)],
      ['CUSTOMER_RETURN', String(result.customerReturnId)],
    ]);
    // The new order's return and the refunds are in the edit's row, not rows of their own.
    expect(await prisma.auditLog.count(counted)).toBe(before);
  });

  it('is its own permission', async () => {
    const first = await order(10);
    const single = await back([{ order: first, accepted: 4 }]);
    const returnId = single.returns[0]?.returnId ?? 0;
    const user = await createEmployee(app, ['orders.view', 'returns.create'], 'clerk');
    const clerk = await login(app, user.username, EMPLOYEE_PASSWORD);
    await http().get(`/api/returns/${returnId}/editable`).set(asUser(clerk)).expect(403);
    await http()
      .post(`/api/returns/${returnId}/replace-customer`)
      .set(asUser(clerk))
      .send(body([{ order: first, accepted: 1 }]))
      .expect(403);
  });
});
