import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type {
  CustomerDto,
  CustomerReturnReceiptDto,
  CustomerReturnResultDto,
  DashboardDto,
  CustomerReturnableDto,
  DriverDto,
  ItemDto,
  LedgerEntryDto,
  OrderDetailDto,
  PageDto,
} from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { createCustomer, createDriver, createItem, createOrder, recordReturn } from '../helpers/factories';

const NOW = new Date('2026-09-11T09:00:00Z');
const TODAY = '2026-09-11';

type Entry = { orderLineId: number; acceptedQuantity: number; damagedQuantity?: number; damagedRefund?: number };

describe('a customer return across their orders (Q156)', () => {
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
  const order = (
    paymentType: 'CASH' | 'LENT',
    lines: { itemId: number; quantity: number }[],
    options: { customerId?: number; date?: string } = {},
  ): Promise<OrderDetailDto> =>
    createOrder(app, admin, {
      customerId: options.customerId ?? customer.id,
      driverId: driver.id,
      date: options.date ?? '2026-09-10',
      paymentType,
      lines,
    });
  const lineOf = (detail: OrderDetailDto, index = 0): number => detail.lines[index]?.id ?? 0;
  const returnable = (customerId = customer.id) =>
    http().get(`/api/customers/${customerId}/returnable`).set(asUser(admin));
  const post = (
    orders: { orderId: number; lines: Entry[] }[],
    options: { key?: string; date?: string; customerId?: number } = {},
  ) =>
    http()
      .post(`/api/customers/${options.customerId ?? customer.id}/returns`)
      .set(asUser(admin))
      .set('Idempotency-Key', options.key ?? randomUUID())
      .send({
        date: options.date ?? TODAY,
        notes: 'Brought back by the driver',
        orders: orders.map((entry) => ({
          orderId: entry.orderId,
          lines: entry.lines.map((line) => ({ damagedQuantity: 0, damagedRefund: 0, ...line })),
        })),
      });
  const onHand = async (itemId: number): Promise<number> =>
    (await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).quantityOnHand;
  const written = async () => ({
    returns: await prisma.palletReturn.count(),
    movements: await prisma.stockMovement.count({ where: { returnId: { not: null } } }),
    refunds: await prisma.ledgerEntry.count({ where: { type: 'REFUND' } }),
    visits: await prisma.customerReturn.count(),
    audit: await prisma.auditLog.count({ where: { action: 'RETURN_CREATE' } }),
  });

  /** The visit a customer return over two orders or more was recorded in (Q161). */
  const visitOf = (result: CustomerReturnResultDto): number => {
    if (result.customerReturnId === null) throw new Error('expected a customer return over several orders');
    return result.customerReturnId;
  };

  it('lists the pallets still out on the open orders, oldest order first, and nothing else', async () => {
    const first = await order('LENT', [
      { itemId: pallet.id, quantity: 10 },
      { itemId: crate.id, quantity: 4 },
    ]);
    const second = await order('CASH', [{ itemId: pallet.id, quantity: 6 }]);
    const settled = await order('LENT', [{ itemId: crate.id, quantity: 2 }]);
    const cancelled = await order('LENT', [{ itemId: crate.id, quantity: 3 }]);
    const other = await createCustomer(app, admin, { name: 'Another', phone: '07509876543' });
    await order('LENT', [{ itemId: pallet.id, quantity: 7 }], { customerId: other.id });
    // The first order's crates all came back: that line is not offered, its pallets are.
    await recordReturn(app, admin, {
      orderId: first.id,
      date: TODAY,
      lines: [{ orderLineId: lineOf(first, 1), acceptedQuantity: 4 }],
    });
    await recordReturn(app, admin, {
      orderId: settled.id,
      date: TODAY,
      lines: [{ orderLineId: lineOf(settled), acceptedQuantity: 2 }],
    });
    await http().post(`/api/orders/${cancelled.id}/cancel`).set(asUser(admin)).send({ version: 1 }).expect(200);

    const body = (await returnable().expect(200)).body as CustomerReturnableDto;

    expect(body.customer).toMatchObject({ id: customer.id, name: customer.name });
    expect(
      body.orders.map((entry) => ({
        id: entry.id,
        owed: entry.owed,
        out: entry.outQuantityTotal,
        lines: entry.lines.map((line) => [line.id, line.item.name, line.outQuantity, line.unitDeposit]),
      })),
    ).toEqual([
      // LENT: 10 × 1,000 + 4 × 500 = 12,000 owed; the 4 crates back credit 2,000.
      { id: first.id, owed: 10_000, out: 10, lines: [[lineOf(first), 'Pallet 120×100', 10, 1_000]] },
      { id: second.id, owed: 0, out: 6, lines: [[lineOf(second), 'Pallet 120×100', 6, 1_000]] },
    ]);
  });

  it('records a return on each order, each priced against its own order', async () => {
    const cash = await order('CASH', [{ itemId: pallet.id, quantity: 100 }]);
    const lent = await order('LENT', [
      { itemId: pallet.id, quantity: 50 },
      { itemId: crate.id, quantity: 20 },
    ]);
    const before = { pallet: await onHand(pallet.id), crate: await onHand(crate.id) };

    const response = await post([
      // Cash: the deposit was paid, so the 40 back are 40,000 handed over.
      { orderId: cash.id, lines: [{ orderLineId: lineOf(cash), acceptedQuantity: 40 }] },
      // Lent: 60,000 owed; 30 pallets back and 2 crates damaged (1,000 deposit, 400 refunded) credit 30,400.
      {
        orderId: lent.id,
        lines: [
          { orderLineId: lineOf(lent), acceptedQuantity: 30 },
          { orderLineId: lineOf(lent, 1), acceptedQuantity: 0, damagedQuantity: 2, damagedRefund: 400 },
        ],
      },
    ]).expect(201);
    const result = response.body as CustomerReturnResultDto;

    expect(result.customer.id).toBe(customer.id);
    expect(
      result.returns.map(({ returnId: _id, refundEntryId, ...rest }) => ({ ...rest, refund: refundEntryId !== null })),
    ).toEqual([
      {
        orderId: cash.id,
        orderNumber: cash.orderNumber,
        accepted: 40,
        damaged: 0,
        refundDue: 40_000,
        owedBefore: 0,
        cashRefund: 40_000,
        owedAfter: 0,
        refund: true,
      },
      {
        orderId: lent.id,
        orderNumber: lent.orderNumber,
        accepted: 30,
        damaged: 2,
        refundDue: 30_400,
        owedBefore: 60_000,
        cashRefund: 0,
        owedAfter: 29_600,
        refund: false,
      },
    ]);
    const stored = await prisma.palletReturn.findMany({ orderBy: { id: 'asc' } });
    expect(stored.map((pr) => [pr.orderId, pr.notes, Number(pr.cashRefund)])).toEqual([
      [cash.id, 'Brought back by the driver', 40_000],
      [lent.id, 'Brought back by the driver', 0],
    ]);
    const refund = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: result.returns[0]?.refundEntryId ?? 0 } });
    expect({ type: refund.type, amount: Number(refund.amount), returnId: refund.returnId }).toEqual({
      type: 'REFUND',
      amount: 40_000,
      returnId: stored[0]?.id,
    });
    // Accepted pallets go back into stock; damaged ones do not (§4.7.1).
    expect({ pallet: await onHand(pallet.id), crate: await onHand(crate.id) }).toEqual({
      pallet: before.pallet + 70,
      crate: before.crate,
    });
    const orders = await prisma.order.findMany({ where: { id: { in: [cash.id, lent.id] } }, orderBy: { id: 'asc' } });
    expect(orders.map((row) => [row.outQuantityTotal, Number(row.owed)])).toEqual([
      [60, 0],
      [38, 29_600],
    ]);
    // One visit (Q161): both returns point to it, and the history has one row for it — none per order, nor per refund.
    const visitId = visitOf(result);
    expect(stored.map((pr) => pr.customerReturnId)).toEqual([visitId, visitId]);
    const visit = await prisma.customerReturn.findUniqueOrThrow({ where: { id: visitId } });
    expect(visit.customerId).toBe(customer.id);
    const history = await prisma.auditLog.findMany({
      where: { action: { in: ['RETURN_CREATE', 'REFUND_CREATE'] } },
    });
    expect(history.map((row) => [row.entityType, row.action, row.entityId, row.summaryParams])).toEqual([
      [
        'CUSTOMER_RETURN',
        'RETURN_CREATE',
        String(visitId),
        { customerName: customer.name, orders: 2, accepted: 70, damaged: 2, refundDue: 70_400, cashRefund: 40_000 },
      ],
    ]);
    // Each refund's own ledger row is kept in full there, since it has no history row of its own.
    const after = history[0]?.after as {
      returns: { id: number; orderNumber: number; refund: { id: number; type: string; amount: number } | null }[];
    };
    expect(after.returns.map((entry) => [entry.id, entry.orderNumber, entry.refund])).toEqual([
      [stored[0]?.id, cash.orderNumber, expect.objectContaining({ id: refund.id, type: 'REFUND', amount: 40_000 })],
      [stored[1]?.id, lent.orderNumber, null],
    ]);
  });

  it('records a return on one order as that order’s own: no visit, its own history rows (Q161)', async () => {
    const cash = await order('CASH', [{ itemId: pallet.id, quantity: 10 }]);
    const result = (
      await post([{ orderId: cash.id, lines: [{ orderLineId: lineOf(cash), acceptedQuantity: 4 }] }]).expect(201)
    ).body as CustomerReturnResultDto;

    expect(result.customerReturnId).toBeNull();
    expect(await prisma.customerReturn.count()).toBe(0);
    const stored = await prisma.palletReturn.findFirstOrThrow();
    expect(stored.customerReturnId).toBeNull();
    const history = await prisma.auditLog.findMany({
      where: { action: { in: ['RETURN_CREATE', 'REFUND_CREATE'] } },
      orderBy: { id: 'asc' },
    });
    expect(history.map((row) => [row.entityType, row.action])).toEqual([
      ['RETURN', 'RETURN_CREATE'],
      ['LEDGER_ENTRY', 'REFUND_CREATE'],
    ]);
  });

  it('writes nothing when any order refuses, and names every line over what is out', async () => {
    const first = await order('LENT', [{ itemId: pallet.id, quantity: 5 }]);
    const second = await order('LENT', [{ itemId: crate.id, quantity: 3 }]);
    const third = await order('LENT', [{ itemId: crate.id, quantity: 8 }]);
    const before = await written();

    const over = await post([
      { orderId: first.id, lines: [{ orderLineId: lineOf(first), acceptedQuantity: 6 }] },
      { orderId: second.id, lines: [{ orderLineId: lineOf(second), acceptedQuantity: 2, damagedQuantity: 2 }] },
      { orderId: third.id, lines: [{ orderLineId: lineOf(third), acceptedQuantity: 8 }] },
    ]).expect(409);

    expect(over.body).toMatchObject({
      error: {
        code: 'RETURN_EXCEEDS_OUT',
        details: {
          lines: [
            { orderLineId: lineOf(first), requested: 6, outQuantity: 5 },
            { orderLineId: lineOf(second), requested: 4, outQuantity: 3 },
          ],
        },
      },
    });
    expect(await written()).toEqual(before);
    expect(await onHand(crate.id)).toBe(500 - 3 - 8);
  });

  it("refuses another customer's order, a cancelled one, a date before an order, an empty return and an order named twice", async () => {
    const mine = await order('LENT', [{ itemId: pallet.id, quantity: 5 }]);
    const late = await order('LENT', [{ itemId: pallet.id, quantity: 5 }], { date: TODAY });
    const other = await createCustomer(app, admin, { name: 'Another', phone: '07509876543' });
    const theirs = await order('LENT', [{ itemId: pallet.id, quantity: 5 }], { customerId: other.id });
    const cancelled = await order('LENT', [{ itemId: crate.id, quantity: 2 }]);
    await http().post(`/api/orders/${cancelled.id}/cancel`).set(asUser(admin)).send({ version: 1 }).expect(200);
    const mineBack = { orderId: mine.id, lines: [{ orderLineId: lineOf(mine), acceptedQuantity: 1 }] };
    const before = await written();

    const foreign = await post([
      mineBack,
      { orderId: theirs.id, lines: [{ orderLineId: lineOf(theirs), acceptedQuantity: 1 }] },
    ]).expect(404);
    expect(foreign.body).toMatchObject({ error: { code: 'ORDER_NOT_FOUND', details: { orderId: theirs.id } } });

    // Another customer's cancelled order is not found here either: its state is not told, and it is never locked.
    const theirsCancelled = await order('LENT', [{ itemId: crate.id, quantity: 1 }], { customerId: other.id });
    await http().post(`/api/orders/${theirsCancelled.id}/cancel`).set(asUser(admin)).send({ version: 1 }).expect(200);
    const foreignCancelled = await post([
      mineBack,
      { orderId: theirsCancelled.id, lines: [{ orderLineId: lineOf(theirsCancelled), acceptedQuantity: 1 }] },
    ]).expect(404);
    expect(foreignCancelled.body).toMatchObject({
      error: { code: 'ORDER_NOT_FOUND', details: { orderId: theirsCancelled.id } },
    });
    const missing = await post([
      mineBack,
      { orderId: 999_999, lines: [{ orderLineId: 1, acceptedQuantity: 1 }] },
    ]).expect(404);
    expect(missing.body).toMatchObject({ error: { code: 'ORDER_NOT_FOUND', details: { orderId: 999_999 } } });

    const gone = await post([
      mineBack,
      { orderId: cancelled.id, lines: [{ orderLineId: lineOf(cancelled), acceptedQuantity: 1 }] },
    ]).expect(409);
    expect(gone.body).toMatchObject({ error: { code: 'ORDER_CANCELLED', details: { orderId: cancelled.id } } });

    const early = await post(
      [mineBack, { orderId: late.id, lines: [{ orderLineId: lineOf(late), acceptedQuantity: 1 }] }],
      { date: '2026-09-10' },
    ).expect(400);
    expect(early.body).toMatchObject({
      error: { code: 'RETURN_DATE_BEFORE_ORDER_DATE', details: { orderDate: TODAY } },
    });

    // A line of another order is not this order's.
    const elsewhere = await post([
      { orderId: mine.id, lines: [{ orderLineId: lineOf(late), acceptedQuantity: 1 }] },
    ]).expect(400);
    expect(elsewhere.body).toMatchObject({ error: { code: 'RETURN_LINE_NOT_IN_ORDER' } });

    const empty = await post([
      { orderId: mine.id, lines: [{ orderLineId: lineOf(mine), acceptedQuantity: 0 }] },
    ]).expect(400);
    expect(empty.body).toMatchObject({ error: { code: 'RETURN_EMPTY' } });

    const twice = await post([mineBack, mineBack]).expect(400);
    expect(twice.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED', fields: [{ path: 'orders.1.orderId', code: 'duplicate' }] },
    });

    const nobody = await post([mineBack], { customerId: 999_999 }).expect(404);
    expect(nobody.body).toMatchObject({ error: { code: 'CUSTOMER_NOT_FOUND' } });
    await returnable(999_999).expect(404);

    expect(await written()).toEqual(before);
  });

  it('is recorded once per idempotency key, a retry answered as the first was', async () => {
    const lent = await order('LENT', [{ itemId: pallet.id, quantity: 10 }]);
    const key = randomUUID();
    const body = [{ orderId: lent.id, lines: [{ orderLineId: lineOf(lent), acceptedQuantity: 4 }] }];

    const first = await post(body, { key }).expect(201);
    const again = await post(body, { key }).expect(201);

    expect(again.headers['idempotency-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect(await prisma.palletReturn.count()).toBe(1);
    const changed = await post([{ orderId: lent.id, lines: [{ orderLineId: lineOf(lent), acceptedQuantity: 3 }] }], {
      key,
    }).expect(409);
    expect(changed.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  describe('one receipt for the visit (Q161)', () => {
    const receipt = (id: number) => http().get(`/api/customer-returns/${id}/receipt`).set(asUser(admin));

    /** Cash 40 pallets back (40,000 out), lent 30 back against 60,000 owed (still owes 30,000), another cash 5. */
    const visitOverThree = async () => {
      const cash = await order('CASH', [{ itemId: pallet.id, quantity: 100 }]);
      const lent = await order('LENT', [{ itemId: pallet.id, quantity: 60 }]);
      const small = await order('CASH', [{ itemId: crate.id, quantity: 10 }]);
      const result = (
        await post([
          { orderId: cash.id, lines: [{ orderLineId: lineOf(cash), acceptedQuantity: 40 }] },
          { orderId: lent.id, lines: [{ orderLineId: lineOf(lent), acceptedQuantity: 30 }] },
          { orderId: small.id, lines: [{ orderLineId: lineOf(small), acceptedQuantity: 5 }] },
        ]).expect(201)
      ).body as CustomerReturnResultDto;
      return { cash, lent, small, result };
    };

    it('sums its orders’ returns as recorded, without an order, numbered by the visit', async () => {
      const { result } = await visitOverThree();
      const paper = (await receipt(visitOf(result)).expect(200)).body as CustomerReturnReceiptDto;

      expect(paper).toMatchObject({
        customerReturnId: visitOf(result),
        receiptNumberDisplay: String(visitOf(result)).padStart(6, '0'),
        date: TODAY,
        printedOn: TODAY,
        // Owed before: 0 + 60,000 + 0; credited 40,000 + 30,000 + 2,500; paid back 40,000 + 2,500; still owed 30,000.
        owedBefore: 60_000,
        credit: 72_500,
        amount: 42_500,
        owedAfter: 30_000,
        note: 'Brought back by the driver',
        reversedOn: null,
        allReversed: false,
        customer: { name: customer.name, phone: customer.phone, address: customer.address },
      });
      expect(paper).not.toHaveProperty('order');
      // Each order's row still prints its own part, and names the visit it belongs to.
      const refunds = result.returns.flatMap((entry) => (entry.refundEntryId === null ? [] : [entry.refundEntryId]));
      expect(refunds).toHaveLength(2);
      for (const id of refunds) {
        await http().get(`/api/ledger-entries/${id}/receipt`).set(asUser(admin)).expect(200);
      }
      const rows = (
        await http().get(`/api/ledger-entries?customerId=${customer.id}&type=REFUND`).set(asUser(admin)).expect(200)
      ).body as PageDto<LedgerEntryDto>;
      expect(rows.items.map((row) => row.customerReturnId)).toEqual([visitOf(result), visitOf(result)]);
    });

    it('has none when no cash went back, and none for a visit that does not exist', async () => {
      const lent = await order('LENT', [{ itemId: pallet.id, quantity: 10 }]);
      const other = await order('LENT', [{ itemId: crate.id, quantity: 10 }]);
      const result = (
        await post([
          { orderId: lent.id, lines: [{ orderLineId: lineOf(lent), acceptedQuantity: 4 }] },
          { orderId: other.id, lines: [{ orderLineId: lineOf(other), acceptedQuantity: 2 }] },
        ]).expect(201)
      ).body as CustomerReturnResultDto;

      const none = await receipt(visitOf(result)).expect(409);
      expect(none.body).toMatchObject({ error: { code: 'CUSTOMER_RETURN_NO_RECEIPT' } });
      const missing = await receipt(visitOf(result) + 1).expect(404);
      expect(missing.body).toMatchObject({ error: { code: 'CUSTOMER_RETURN_NOT_FOUND' } });
    });

    it('says what it said once one of its returns is corrected, stamped as partly, then wholly reversed', async () => {
      const { cash, result } = await visitOverThree();
      const [first, second, third] = result.returns;
      const original = (await receipt(visitOf(result)).expect(200)).body as CustomerReturnReceiptDto;

      // An edit of one order's return is that order's own act: the replacement is not in the visit.
      await http()
        .post(`/api/returns/${first?.returnId}/replace`)
        .set(asUser(admin))
        .send({
          date: TODAY,
          lines: [{ orderLineId: lineOf(cash), acceptedQuantity: 20, damagedQuantity: 0, damagedRefund: 0 }],
        })
        .expect(201);
      const partly = (await receipt(visitOf(result)).expect(200)).body as CustomerReturnReceiptDto;
      expect(partly).toEqual({ ...original, reversedOn: TODAY, allReversed: false });
      const replacement = await prisma.palletReturn.findFirstOrThrow({ where: { replaces: { id: first?.returnId } } });
      expect(replacement.customerReturnId).toBeNull();

      for (const entry of [second, third]) {
        await http().delete(`/api/returns/${entry?.returnId}`).set(asUser(admin)).expect(200);
      }
      const reversedAll = (await receipt(visitOf(result)).expect(200)).body as CustomerReturnReceiptDto;
      expect(reversedAll).toEqual({ ...original, reversedOn: TODAY, allReversed: true });
    });

    it('is one event on the dashboard, its returns and refunds none of their own', async () => {
      const { result } = await visitOverThree();
      const dashboard = (await http().get('/api/dashboard').set(asUser(admin)).expect(200)).body as DashboardDto;
      const events = (dashboard.recentActivity ?? []).filter((event) => event.kind !== 'HANDOVER');

      expect(events).toEqual([
        {
          kind: 'CUSTOMER_RETURN',
          at: expect.any(String) as string,
          date: TODAY,
          orderId: null,
          orderNumber: null,
          customerReturnId: visitOf(result),
          orderCount: 3,
          customer: expect.objectContaining({ id: customer.id }) as object,
          quantity: 75,
          // The cash handed back (40,000 + 2,500), its receipt's headline; its refunds have no lines of their own.
          amount: 42_500,
          reversed: false,
          partlyReversed: false,
        },
      ]);
    });

    it('reports no cash as 0 on the dashboard, with its pallets beside it', async () => {
      const first = await order('LENT', [{ itemId: pallet.id, quantity: 10 }]);
      const second = await order('LENT', [{ itemId: crate.id, quantity: 10 }]);
      await post([
        { orderId: first.id, lines: [{ orderLineId: lineOf(first), acceptedQuantity: 4 }] },
        { orderId: second.id, lines: [{ orderLineId: lineOf(second), acceptedQuantity: 3 }] },
      ]).expect(201);
      const dashboard = (await http().get('/api/dashboard').set(asUser(admin)).expect(200)).body as DashboardDto;
      const visit = (dashboard.recentActivity ?? []).find((event) => event.kind === 'CUSTOMER_RETURN');

      // No cash: the true 0, which the page shows as the pallets instead.
      expect(visit).toMatchObject({ quantity: 7, amount: 0, orderCount: 2 });
    });

    it('stays on the dashboard as recorded, flagged as partly and then wholly reversed, as its paper is', async () => {
      const { cash, result } = await visitOverThree();
      const [first, second, third] = result.returns;
      const events = async () =>
        (
          ((await http().get('/api/dashboard').set(asUser(admin)).expect(200)).body as DashboardDto).recentActivity ??
          []
        )
          .filter((event) => event.kind !== 'HANDOVER')
          .map((event) => [event.kind, event.quantity, event.amount, event.reversed, event.partlyReversed]);

      // The cash order's 40 corrected to 20: the replacement is its order's own return and refund, and the visit
      // keeps its figures, flagged — never silently smaller, nor counted as if it still stood whole.
      await http()
        .post(`/api/returns/${first?.returnId}/replace`)
        .set(asUser(admin))
        .send({
          date: TODAY,
          lines: [{ orderLineId: lineOf(cash), acceptedQuantity: 20, damagedQuantity: 0, damagedRefund: 0 }],
        })
        .expect(201);
      expect(await events()).toEqual([
        ['REFUND', null, 20_000, false, false],
        ['RETURN', 20, 20_000, false, false],
        ['CUSTOMER_RETURN', 75, 42_500, false, true],
      ]);

      // A deletion has no replacement: the flag is what shows it.
      await http().delete(`/api/returns/${second?.returnId}`).set(asUser(admin)).expect(200);
      expect((await events()).at(-1)).toEqual(['CUSTOMER_RETURN', 75, 42_500, false, true]);
      await http().delete(`/api/returns/${third?.returnId}`).set(asUser(admin)).expect(200);
      expect((await events()).at(-1)).toEqual(['CUSTOMER_RETURN', 75, 42_500, true, false]);
    });

    it('keeps each refund on its return’s visit, written by the database whatever the writer sends', async () => {
      const { lent, result } = await visitOverThree();
      const refunds = await prisma.ledgerEntry.findMany({ where: { type: 'REFUND' }, orderBy: { id: 'asc' } });
      expect(refunds.map((entry) => entry.customerReturnId)).toEqual([visitOf(result), visitOf(result)]);

      // A refund written without its visit, or with another one, still carries its return's. Rolled back: these are
      // bare rows written around the services, and the file still reconciles.
      const lentReturn = result.returns.find((entry) => entry.orderId === lent.id)?.returnId ?? 0;
      const other = (await visitOverThree()).result;
      const rollback = new Error('rollback');
      const written: (number | null | undefined)[] = [];
      await expect(
        prisma.$transaction(async (tx) => {
          for (const sent of [null, visitOf(other)]) {
            const [row] = await tx.$queryRaw<{ customer_return_id: number | null }[]>`
              INSERT INTO ledger_entries
                (order_id, type, source, amount, date, return_id, customer_return_id, created_by_user_id)
              VALUES (${lent.id}, 'REFUND', 'RETURN_CREATE', 1, ${TODAY}::date, ${lentReturn}, ${sent},
                      ${refunds[0]?.createdByUserId ?? 0})
              RETURNING customer_return_id`;
            written.push(row?.customer_return_id);
          }
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      expect(written).toEqual([visitOf(result), visitOf(result)]);
    });
  });
});
