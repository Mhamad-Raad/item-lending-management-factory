import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type {
  CustomerDto,
  CustomerReturnEditableDto,
  CustomerReturnResultDto,
  DriverDto,
  ItemDto,
  OrderDetailDto,
  PageDto,
  ReceiptDto,
  ReceiptRowDto,
  ReturnListItemDto,
} from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { createCustomer, createDriver, createItem, createOrder } from '../helpers/factories';

const NOW = new Date('2026-10-28T09:00:00Z');
const TODAY = '2026-10-28';

describe('a return recorded with an order, taking back other orders’ pallets too (Q175)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;
  let pallet: ItemDto;
  let crate: ItemDto;
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
    crate = await createItem(app, admin, { name: 'Crate', depositPrice: 500, stock: 500 });
    customer = await createCustomer(app, admin);
    driver = await createDriver(app, admin);
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const order = (lines: { itemId: number; quantity: number }[], customerId = customer.id): Promise<OrderDetailDto> =>
    createOrder(app, admin, { customerId, driverId: driver.id, date: '2026-10-20', paymentType: 'LENT', lines });
  const lineOf = (detail: OrderDetailDto, index = 0): number => detail.lines[index]?.id ?? 0;
  const post = (
    orders: { orderId: number; lines: { orderLineId: number; acceptedQuantity: number; damagedQuantity?: number }[] }[],
    withOrderId?: number,
  ) =>
    http()
      .post(`/api/customers/${customer.id}/returns`)
      .set(asUser(admin))
      .set('Idempotency-Key', randomUUID())
      .send({
        date: TODAY,
        orders: orders.map((entry) => ({
          orderId: entry.orderId,
          lines: entry.lines.map((line) => ({ damagedQuantity: 0, damagedRefund: 0, ...line })),
        })),
        surplus: [],
        ...(withOrderId === undefined ? {} : { withOrderId }),
      });
  const receipt = async (orderId: number): Promise<ReceiptDto> =>
    (await http().get(`/api/orders/${orderId}/receipt`).set(asUser(admin)).expect(200)).body as ReceiptDto;
  const rowsOf = (paper: ReceiptDto): ReceiptRowDto[] => paper.sheets.flatMap((sheet) => sheet.rows);
  const detail = async (orderId: number): Promise<OrderDetailDto> =>
    (await http().get(`/api/orders/${orderId}`).set(asUser(admin)).expect(200)).body as OrderDetailDto;

  it('lands each part on its own order, every one remembering the order it was recorded with', async () => {
    const older = await order([{ itemId: pallet.id, quantity: 10 }]);
    const newer = await order([{ itemId: crate.id, quantity: 4 }]);
    const response = await post(
      [
        { orderId: older.id, lines: [{ orderLineId: lineOf(older), acceptedQuantity: 6, damagedQuantity: 1 }] },
        { orderId: newer.id, lines: [{ orderLineId: lineOf(newer), acceptedQuantity: 2 }] },
      ],
      newer.id,
    ).expect(201);
    const result = response.body as CustomerReturnResultDto;

    const stored = await prisma.palletReturn.findMany({ orderBy: { id: 'asc' } });
    expect(stored.map((pr) => [pr.orderId, pr.withOrderId])).toEqual([
      [older.id, newer.id],
      [newer.id, newer.id],
    ]);
    // Counted on its own order only: the older order's pallets came back, the newer's crates likewise.
    expect((await detail(older.id)).lines[0]).toMatchObject({
      returnedAccepted: 6,
      returnedDamaged: 1,
      outQuantity: 3,
    });
    expect((await detail(newer.id)).lines[0]).toMatchObject({ returnedAccepted: 2, outQuantity: 2 });
    // The tag names the other order only where it is another than the return's own.
    expect((await detail(older.id)).returns[0]?.withOrder).toEqual({ id: newer.id, orderNumber: newer.orderNumber });
    expect((await detail(newer.id)).returns[0]?.withOrder).toBeNull();
    const list = (await http().get('/api/returns').set(asUser(admin)).expect(200)).body as PageDto<ReturnListItemDto>;
    expect(list.items.map((row) => [row.orderId, row.withOrder?.id ?? null])).toEqual([
      [newer.id, null],
      [older.id, newer.id],
    ]);
    expect(result.returns).toHaveLength(2);
  });

  it("prints on the order's receipt what came back with it, and on the other order's only in its own columns", async () => {
    const first = await order([{ itemId: pallet.id, quantity: 10 }]);
    const second = await order([
      { itemId: pallet.id, quantity: 5 },
      { itemId: crate.id, quantity: 3 },
    ]);
    const withOrder = await order([{ itemId: crate.id, quantity: 2 }]);
    await post(
      [
        { orderId: first.id, lines: [{ orderLineId: lineOf(first), acceptedQuantity: 4, damagedQuantity: 1 }] },
        {
          orderId: second.id,
          lines: [
            { orderLineId: lineOf(second), acceptedQuantity: 5 },
            { orderLineId: lineOf(second, 1), acceptedQuantity: 3 },
          ],
        },
      ],
      withOrder.id,
    ).expect(201);

    const own = await receipt(withOrder.id);
    expect(rowsOf(own).filter((row) => row.kind === 'withHeading' || row.kind === 'with')).toEqual([
      { kind: 'withHeading' },
      // One row per item over both orders, naming neither (Q177).
      { kind: 'with', no: 2, itemName: 'Pallet 120×100', accepted: 9, damaged: 1 },
      { kind: 'with', no: 3, itemName: 'Crate', accepted: 3, damaged: 0 },
    ]);
    // None of it in this order's figures: its own line and deposit as they were.
    expect(rowsOf(own)[0]).toMatchObject({ kind: 'line', returnedAccepted: 0, outQuantity: 2 });
    expect(own.depositTotal).toBe(1_000);

    // The first order's own pallets that came back with another order are in its returned columns, and only there
    // (Q179).
    const earlier = await receipt(first.id);
    expect(rowsOf(earlier)).toEqual([
      expect.objectContaining({ kind: 'line', returnedAccepted: 4, returnedDamaged: 1, outQuantity: 5 }),
    ]);
  });

  it('counts what came back with other orders, and with none or its own, in the returned columns alone (Q179)', async () => {
    const first = await order([{ itemId: pallet.id, quantity: 10 }]);
    const withA = await order([{ itemId: crate.id, quantity: 1 }]);
    const withB = await order([{ itemId: crate.id, quantity: 1 }]);
    await post([{ orderId: first.id, lines: [{ orderLineId: lineOf(first), acceptedQuantity: 2 }] }], withA.id).expect(
      201,
    );
    await post(
      [{ orderId: first.id, lines: [{ orderLineId: lineOf(first), acceptedQuantity: 3, damagedQuantity: 1 }] }],
      withB.id,
    ).expect(201);
    // And one recorded with no order (with_order_id NULL), and one from its own order's page.
    await post([{ orderId: first.id, lines: [{ orderLineId: lineOf(first), acceptedQuantity: 1 }] }]).expect(201);
    await post([{ orderId: first.id, lines: [{ orderLineId: lineOf(first), acceptedQuantity: 1 }] }], first.id).expect(
      201,
    );

    expect(rowsOf(await receipt(first.id))).toEqual([
      expect.objectContaining({ kind: 'line', returnedAccepted: 7, returnedDamaged: 1, outQuantity: 2 }),
    ]);
  });

  it('forgets on both receipts a return deleted since', async () => {
    const first = await order([{ itemId: pallet.id, quantity: 10 }]);
    const withOrder = await order([{ itemId: crate.id, quantity: 2 }]);
    const result = (
      await post(
        [{ orderId: first.id, lines: [{ orderLineId: lineOf(first), acceptedQuantity: 4 }] }],
        withOrder.id,
      ).expect(201)
    ).body as CustomerReturnResultDto;
    await http().delete(`/api/returns/${result.returns[0]?.returnId}`).set(asUser(admin)).expect(200);

    // The first order's pallets are out again, so listed as earlier pallets still out — beside this order's crates
    // (Q178) — and nothing as came back.
    expect(rowsOf(await receipt(withOrder.id)).map((row) => row.kind)).toEqual([
      'line',
      'olderHeading',
      'older',
      'older',
    ]);
    expect(rowsOf(await receipt(first.id)).map((row) => row.kind)).toEqual(['line']);
  });

  it("refuses another customer's order and a cancelled one to record with, writing nothing", async () => {
    const first = await order([{ itemId: pallet.id, quantity: 10 }]);
    const other = await createCustomer(app, admin, { name: 'Another', phone: '07509876543' });
    const foreign = await order([{ itemId: crate.id, quantity: 1 }], other.id);
    const cancelled = await order([{ itemId: crate.id, quantity: 1 }]);
    await http().post(`/api/orders/${cancelled.id}/cancel`).set(asUser(admin)).send({ version: 1 }).expect(200);
    const lines = [{ orderId: first.id, lines: [{ orderLineId: lineOf(first), acceptedQuantity: 1 }] }];

    const refusedForeign = await post(lines, foreign.id).expect(404);
    expect(refusedForeign.body.error).toMatchObject({ code: 'ORDER_NOT_FOUND', details: { orderId: foreign.id } });
    const refusedCancelled = await post(lines, cancelled.id).expect(409);
    expect(refusedCancelled.body.error).toMatchObject({ code: 'ORDER_CANCELLED', details: { orderId: cancelled.id } });
    expect(await prisma.palletReturn.count()).toBe(0);
  });

  it('keeps the order it was recorded with through an edit from the list and a correction on the order', async () => {
    const first = await order([{ itemId: pallet.id, quantity: 10 }]);
    const second = await order([{ itemId: crate.id, quantity: 4 }]);
    const withOrder = await order([{ itemId: crate.id, quantity: 2 }]);
    const recorded = (
      await post(
        [{ orderId: first.id, lines: [{ orderLineId: lineOf(first), acceptedQuantity: 4 }] }],
        withOrder.id,
      ).expect(201)
    ).body as CustomerReturnResultDto;
    const returnId = recorded.returns[0]?.returnId ?? 0;

    const editable = (await http().get(`/api/returns/${returnId}/editable`).set(asUser(admin)).expect(200))
      .body as CustomerReturnEditableDto;
    expect(editable.withOrder).toEqual({ id: withOrder.id, orderNumber: withOrder.orderNumber, date: '2026-10-20' });
    // Edited to take the second order's crates too: both parts keep it, the new one included.
    const edited = (
      await http()
        .post(`/api/returns/${returnId}/replace-customer`)
        .set(asUser(admin))
        .send({
          date: TODAY,
          orders: [
            { orderId: first.id, lines: [{ orderLineId: lineOf(first), acceptedQuantity: 5, damagedQuantity: 0 }] },
            { orderId: second.id, lines: [{ orderLineId: lineOf(second), acceptedQuantity: 1, damagedQuantity: 0 }] },
          ],
          surplus: [],
          reopened: [],
        })
        .expect(201)
    ).body as CustomerReturnResultDto;
    const standing = await prisma.palletReturn.findMany({ where: { reversedAt: null }, orderBy: { id: 'asc' } });
    expect(standing.map((pr) => [pr.orderId, pr.withOrderId])).toEqual([
      [first.id, withOrder.id],
      [second.id, withOrder.id],
    ]);
    // The edit names no order of its own to record with: refused, as any unknown field.
    await http()
      .post(`/api/returns/${edited.returns[0]?.returnId}/replace-customer`)
      .set(asUser(admin))
      .send({ date: TODAY, orders: [], surplus: [], reopened: [], withOrderId: first.id })
      .expect(400);

    // A correction on the first order's page keeps it too.
    const corrected = await http()
      .post(`/api/returns/${edited.returns[0]?.returnId}/replace`)
      .set(asUser(admin))
      .send({ date: TODAY, lines: [{ orderLineId: lineOf(first), acceptedQuantity: 3, damagedQuantity: 0 }] })
      .expect(201);
    const replacement = await prisma.palletReturn.findUniqueOrThrow({ where: { id: corrected.body.returnId } });
    expect(replacement.withOrderId).toBe(withOrder.id);
  });

  it("is refused by the database when recorded with another customer's order", async () => {
    const first = await order([{ itemId: pallet.id, quantity: 10 }]);
    const other = await createCustomer(app, admin, { name: 'Another', phone: '07509876543' });
    const foreign = await order([{ itemId: crate.id, quantity: 1 }], other.id);
    const user = await prisma.user.findFirstOrThrow();
    await expect(
      prisma.palletReturn.create({
        data: {
          orderId: first.id,
          withOrderId: foreign.id,
          date: new Date(TODAY),
          refundDue: 0n,
          owedBefore: 0n,
          cashRefund: 0n,
          createdByUserId: user.id,
        },
      }),
    ).rejects.toThrow(/recorded with an order of its own customer/);
  });

  it('makes the order it was recorded with active: never cancelled under it, nor dated after it', async () => {
    const first = await order([{ itemId: pallet.id, quantity: 10 }]);
    const withOrder = await order([{ itemId: crate.id, quantity: 2 }]);
    const result = (
      await http()
        .post(`/api/customers/${customer.id}/returns`)
        .set(asUser(admin))
        .set('Idempotency-Key', randomUUID())
        .send({
          date: '2026-10-24',
          orders: [
            {
              orderId: first.id,
              lines: [{ orderLineId: lineOf(first), acceptedQuantity: 4, damagedQuantity: 0, damagedRefund: 0 }],
            },
          ],
          surplus: [],
          withOrderId: withOrder.id,
        })
        .expect(201)
    ).body as CustomerReturnResultDto;

    expect((await detail(withOrder.id)).canCancel).toBe(false);
    const refused = await http()
      .post(`/api/orders/${withOrder.id}/cancel`)
      .set(asUser(admin))
      .send({ version: (await detail(withOrder.id)).version })
      .expect(409);
    expect(refused.body.error).toMatchObject({ code: 'ORDER_HAS_ACTIVITY', details: { nonReversedReturnCount: 1 } });
    const moved = await http()
      .patch(`/api/orders/${withOrder.id}`)
      .set(asUser(admin))
      .send({ version: (await detail(withOrder.id)).version, date: '2026-10-27' })
      .expect(409);
    expect(moved.body.error).toMatchObject({ code: 'ORDER_DATE_AFTER_ACTIVITY' });

    // Once the return is deleted, the order is its own again.
    await http().delete(`/api/returns/${result.returns[0]?.returnId}`).set(asUser(admin)).expect(200);
    expect((await detail(withOrder.id)).canCancel).toBe(true);
  });

  it('refuses a return dated before the order it is recorded with, recorded or edited', async () => {
    const first = await order([{ itemId: pallet.id, quantity: 10 }]);
    const withOrder = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: '2026-10-25',
      paymentType: 'LENT',
      lines: [{ itemId: crate.id, quantity: 2 }],
    });
    const early = await http()
      .post(`/api/customers/${customer.id}/returns`)
      .set(asUser(admin))
      .set('Idempotency-Key', randomUUID())
      .send({
        date: '2026-10-22',
        orders: [
          {
            orderId: first.id,
            lines: [{ orderLineId: lineOf(first), acceptedQuantity: 1, damagedQuantity: 0, damagedRefund: 0 }],
          },
        ],
        surplus: [],
        withOrderId: withOrder.id,
      })
      .expect(400);
    expect(early.body.error).toMatchObject({
      code: 'RETURN_DATE_BEFORE_ORDER_DATE',
      details: { orderDate: '2026-10-25' },
    });
    expect(await prisma.palletReturn.count()).toBe(0);

    const result = (
      await post(
        [{ orderId: first.id, lines: [{ orderLineId: lineOf(first), acceptedQuantity: 1 }] }],
        withOrder.id,
      ).expect(201)
    ).body as CustomerReturnResultDto;
    const returnId = result.returns[0]?.returnId ?? 0;
    const lines = [{ orderLineId: lineOf(first), acceptedQuantity: 2, damagedQuantity: 0 }];
    await http()
      .post(`/api/returns/${returnId}/replace-customer`)
      .set(asUser(admin))
      .send({ date: '2026-10-22', orders: [{ orderId: first.id, lines }], surplus: [], reopened: [] })
      .expect(400);
    await http()
      .post(`/api/returns/${returnId}/replace`)
      .set(asUser(admin))
      .send({ date: '2026-10-22', lines })
      .expect(400);
    expect(await prisma.palletReturn.count({ where: { reversedAt: null } })).toBe(1);
  });
});
