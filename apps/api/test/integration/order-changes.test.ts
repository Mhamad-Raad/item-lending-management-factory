import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type {
  CustomerDetailDto,
  CustomerDto,
  DriverDto,
  ItemDto,
  LedgerEntryDto,
  OrderDetailDto,
  PageDto,
  ReceiptDto,
} from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { PrismaService } from '../../src/prisma/prisma.service';
import { findLedgerDiscrepancies } from '../../src/prisma/reconciliation';
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
  recordReturn,
} from '../helpers/factories';

/** "today = 2026-09-11" of the worked examples (§4.10), midday in Baghdad. */
const NOW = new Date('2026-09-11T09:00:00Z');
const TODAY = '2026-09-11';

describe('order changes: edit, cancel, receipt, ledger (§4.8.2, §4.8.3, §6.19)', () => {
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
  const patch = (session: Session, orderId: number, body: Record<string, unknown>): request.Test =>
    http().patch(`/api/orders/${orderId}`).set(asUser(session)).send(body);
  const cancel = (session: Session, orderId: number, version: number): request.Test =>
    http().post(`/api/orders/${orderId}/cancel`).set(asUser(session)).send({ version });
  const order100 = (paymentType: 'CASH' | 'LENT', customerId = customer.id): Promise<OrderDetailDto> =>
    createOrder(app, admin, {
      customerId,
      driverId: driver.id,
      date: TODAY,
      paymentType,
      lines: [{ itemId: item.id, quantity: 100 }],
    });
  const onHand = async (itemId: number): Promise<number> =>
    (await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).quantityOnHand;
  const movements = (orderId: number): Promise<{ reason: string; quantity: number }[]> =>
    prisma.stockMovement.findMany({
      where: { orderId },
      orderBy: { id: 'asc' },
      select: { reason: true, quantity: true },
    });
  const outValueOf = async (customerId: number): Promise<number> =>
    ((await http().get(`/api/customers/${customerId}`).set(asUser(admin)).expect(200)).body as CustomerDetailDto)
      .summary.outValue ?? Number.NaN;

  it('E7 — a cash line edit re-issues the automatic payment for the new total', async () => {
    const created = await order100('CASH');

    const response = await patch(admin, created.id, {
      version: 1,
      lines: [{ itemId: item.id, quantity: 60 }],
    }).expect(200);

    const order = response.body as OrderDetailDto;
    expect(order).toMatchObject({
      depositTotal: 60_000,
      paymentsNet: 60_000,
      creditsTotal: 0,
      refundsNet: 0,
      owed: 0,
      outValue: 60_000,
      held: 60_000,
      status: 'OPEN',
      version: 2,
    });
    const [first, reversal, reissued] = order.ledgerEntries;
    expect(order.ledgerEntries).toHaveLength(3);
    expect(first).toMatchObject({ type: 'PAYMENT', source: 'ORDER_CREATE', amount: 100_000, isReversed: true });
    expect(reversal).toMatchObject({
      type: 'PAYMENT_REVERSAL',
      source: 'ORDER_LINE_EDIT',
      amount: 100_000,
      date: TODAY,
      reversesEntryId: first?.id,
      isAutomatic: false,
    });
    expect(reissued).toMatchObject({
      type: 'PAYMENT',
      source: 'ORDER_LINE_EDIT',
      amount: 60_000,
      date: null,
      isAutomatic: true,
      isReversed: false,
    });
    expect(await movements(created.id)).toEqual([
      { reason: 'ORDER_CREATE', quantity: -100 },
      { reason: 'ORDER_LINE_EDIT', quantity: 40 },
    ]);
    expect(await onHand(item.id)).toBe(440);

    const history = await prisma.auditLog.findMany({
      where: { action: { in: ['UPDATE', 'PAYMENT_REVERSE', 'PAYMENT_CREATE'] } },
      orderBy: { id: 'asc' },
      select: { action: true, summaryParams: true, before: true, after: true },
    });
    expect(history.slice(-3).map((row) => [row.action, row.summaryParams])).toEqual([
      ['UPDATE', { orderNumber: 1, fields: ['lines'] }],
      ['PAYMENT_REVERSE', { orderNumber: 1, amount: 100_000 }],
      ['PAYMENT_CREATE', { orderNumber: 1, amount: 60_000, automatic: true }],
    ]);
    expect(history.at(-3)?.before).toEqual({
      lines: [{ itemId: item.id, quantity: 100, unitDeposit: 1_000, lineTotal: 100_000 }],
    });
    expect(history.at(-3)?.after).toEqual({
      lines: [{ itemId: item.id, quantity: 60, unitDeposit: 1_000, lineTotal: 60_000 }],
    });
    expect(await findLedgerDiscrepancies(prisma)).toEqual([]);
  });

  it('E9 — cancelling brings the pallets back, zeroes the order, and leaves the customer out of it', async () => {
    const created = await order100('LENT');
    expect(await outValueOf(customer.id)).toBe(100_000);

    const response = await cancel(admin, created.id, 1).expect(200);

    expect(response.body).toMatchObject({
      orderNumber: 1,
      status: 'CANCELLED',
      depositTotal: 100_000,
      owed: 0,
      outValue: 0,
      held: 0,
      outQuantityTotal: 0,
      cancelledBy: { username: 'admin' },
      canEditLines: false,
      canCancel: false,
      version: 2,
      ledgerEntries: [],
    });
    expect(await movements(created.id)).toEqual([
      { reason: 'ORDER_CREATE', quantity: -100 },
      { reason: 'ORDER_CANCEL', quantity: 100 },
    ]);
    expect(await onHand(item.id)).toBe(500);
    expect(await outValueOf(customer.id)).toBe(0);
    expect(await findLedgerDiscrepancies(prisma)).toEqual([]);
  });

  it('I4 — cancelling a cash order reverses its payment; activity blocks it until the activity is undone', async () => {
    const cash = await order100('CASH');
    const cancelled = (await cancel(admin, cash.id, 1).expect(200)).body as OrderDetailDto;
    expect(cancelled.ledgerEntries.at(-1)).toMatchObject({
      type: 'PAYMENT_REVERSAL',
      source: 'ORDER_CANCEL',
      amount: 100_000,
      date: TODAY,
    });
    expect(cancelled.paymentsNet).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'CANCEL' } });
    expect(audit.summaryParams).toEqual({ orderNumber: 1, customerName: customer.name });

    expect((await cancel(admin, cash.id, 2).expect(409)).body).toMatchObject({ error: { code: 'ORDER_CANCELLED' } });
    expect((await patch(admin, cash.id, { version: 2, notes: 'late' }).expect(409)).body).toMatchObject({
      error: { code: 'ORDER_CANCELLED' },
    });
    const receipt = await http().get(`/api/orders/${cash.id}/receipt`).set(asUser(admin)).expect(409);
    expect(receipt.body).toMatchObject({ error: { code: 'ORDER_CANCELLED' } });

    const lent = await order100('LENT');
    const paymentId = await recordPayment(app, admin, { orderId: lent.id, amount: 40_000, date: TODAY });
    const blocked = await cancel(admin, lent.id, 2).expect(409);
    expect(blocked.body).toMatchObject({
      error: { code: 'ORDER_HAS_ACTIVITY', details: { nonReversedReturnCount: 0, nonReversedManualPaymentCount: 1 } },
    });

    await http().post(`/api/ledger-entries/${paymentId}/reverse`).set(asUser(admin)).send({}).expect(200);
    const allowed = await cancel(admin, lent.id, 3).expect(200);
    expect((allowed.body as OrderDetailDto).orderNumber).toBe(2);
    expect(await findLedgerDiscrepancies(prisma)).toEqual([]);
  });

  it('I5 — a credit line edit adds and removes lines, moves stock, and leaves the ledger alone', async () => {
    const half = await createItem(app, admin, { name: 'Half pallet', depositPrice: 500, stock: 50 });
    const block = await createItem(app, admin, { name: 'Block pallet', depositPrice: 2_000, stock: 20 });
    const created = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: TODAY,
      lines: [
        { itemId: item.id, quantity: 100 },
        { itemId: half.id, quantity: 10 },
      ],
    });

    const response = await patch(admin, created.id, {
      version: 1,
      lines: [
        { itemId: item.id, quantity: 80 },
        { itemId: block.id, quantity: 5 },
      ],
    }).expect(200);

    const order = response.body as OrderDetailDto;
    expect(order.lines.map((line) => [line.item.name, line.quantity, line.unitDeposit, line.outQuantity])).toEqual([
      ['Pallet 120×100', 80, 1_000, 80],
      ['Block pallet', 5, 2_000, 5],
    ]);
    expect(order).toMatchObject({ depositTotal: 90_000, owed: 90_000, outValue: 90_000, ledgerEntries: [] });
    expect([await onHand(item.id), await onHand(half.id), await onHand(block.id)]).toEqual([420, 50, 15]);
    expect(await movements(created.id)).toEqual(
      expect.arrayContaining([
        { reason: 'ORDER_LINE_EDIT', quantity: 20 },
        { reason: 'ORDER_LINE_EDIT', quantity: 10 },
        { reason: 'ORDER_LINE_EDIT', quantity: -5 },
      ]),
    );

    // Sending the stored lines back is no change at all (Q37).
    const same = await patch(admin, created.id, {
      version: 2,
      lines: [
        { itemId: item.id, quantity: 80 },
        { itemId: block.id, quantity: 5 },
      ],
    }).expect(200);
    expect((same.body as OrderDetailDto).version).toBe(2);
    expect(await findLedgerDiscrepancies(prisma)).toEqual([]);
  });

  it('refuses to remove a line a return was recorded on, even a reversed one; the line may still shrink', async () => {
    const half = await createItem(app, admin, { name: 'Half pallet', depositPrice: 500, stock: 50 });
    const created = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: TODAY,
      lines: [
        { itemId: item.id, quantity: 100 },
        { itemId: half.id, quantity: 10 },
      ],
    });
    const halfLine = created.lines.find((line) => line.item.id === half.id);
    const returnId = await recordReturn(app, admin, {
      orderId: created.id,
      date: TODAY,
      lines: [{ orderLineId: halfLine?.id ?? 0, acceptedQuantity: 4 }],
    });
    await http().delete(`/api/returns/${returnId}`).set(asUser(admin)).expect(200);

    // The return and its deletion each moved the order on a version.
    const removed = await patch(admin, created.id, { version: 3, lines: [{ itemId: item.id, quantity: 100 }] });
    expect(removed.status).toBe(409);
    expect(removed.body).toMatchObject({ error: { code: 'ORDER_LINE_HAS_RETURNS', details: { itemId: half.id } } });

    await patch(admin, created.id, {
      version: 3,
      lines: [
        { itemId: item.id, quantity: 100 },
        { itemId: half.id, quantity: 5 },
      ],
    }).expect(200);
  });

  it('I5 — only a user who may set unit deposits changes one; an archived item cannot grow', async () => {
    const created = await order100('LENT');
    const clerk = await createEmployee(app, ['orders.view', 'orders.edit'], 'clerk');
    const session = await login(app, clerk.username, EMPLOYEE_PASSWORD);

    const refused = await patch(session, created.id, {
      version: 1,
      lines: [{ itemId: item.id, quantity: 100, unitDeposit: 900 }],
    }).expect(403);
    expect(refused.body).toMatchObject({
      error: { code: 'UNIT_DEPOSIT_NOT_PERMITTED', details: { lineIndexes: [0] } },
    });

    const priced = await patch(admin, created.id, {
      version: 1,
      lines: [{ itemId: item.id, quantity: 100, unitDeposit: 900 }],
    }).expect(200);
    expect((priced.body as OrderDetailDto).lines[0]).toMatchObject({ unitDeposit: 900, lineTotal: 90_000 });

    await prisma.item.update({ where: { id: item.id }, data: { archivedAt: NOW, archivedByUserId: 1 } });
    const grown = await patch(admin, created.id, { version: 2, lines: [{ itemId: item.id, quantity: 101 }] });
    expect(grown.body).toMatchObject({ error: { code: 'ITEM_ARCHIVED', details: { itemId: item.id } } });
    await patch(admin, created.id, { version: 2, lines: [{ itemId: item.id, quantity: 90 }] }).expect(200);
  });

  it('I7 — a larger order meets the credit limit again; a smaller one never does', async () => {
    const limited = await createCustomer(app, admin, {
      name: 'Limited Blocks',
      phone: '07509998877',
      creditLimit: 150_000,
    });
    const created = await order100('LENT', limited.id);
    const clerk = await createEmployee(app, ['orders.view', 'orders.edit'], 'clerk');
    const session = await login(app, clerk.username, EMPLOYEE_PASSWORD);

    const grown = await patch(session, created.id, { version: 1, lines: [{ itemId: item.id, quantity: 160 }] });
    expect(grown.body).toMatchObject({
      error: {
        code: 'CREDIT_LIMIT_EXCEEDED',
        details: {
          creditLimit: 150_000,
          customerOutValue: 100_000,
          depositDelta: 60_000,
          excess: 10_000,
          canOverride: false,
        },
      },
    });
    const overridden = await patch(admin, created.id, {
      version: 1,
      lines: [{ itemId: item.id, quantity: 160 }],
      confirmCreditOverride: true,
    }).expect(200);
    expect((overridden.body as OrderDetailDto).creditOverride).toMatchObject({ by: { username: 'admin' } });

    // Now over the limit, the order may still shrink.
    await patch(session, created.id, { version: 2, lines: [{ itemId: item.id, quantity: 155 }] }).expect(200);
  });

  it('checks the header: version, an active driver, and a date no later than the first activity', async () => {
    const created = await order100('LENT');
    const gone = await createDriver(app, admin, { name: 'Omar Salih', phone: '07503334455' });
    await http().delete(`/api/drivers/${gone.id}?version=1`).set(asUser(admin)).expect(200);

    expect((await patch(admin, created.id, { version: 1, driverId: gone.id })).body).toMatchObject({
      error: { code: 'DRIVER_ARCHIVED' },
    });
    await patch(admin, created.id, { version: 1 }).expect(400);

    const notes = await patch(admin, created.id, { version: 1, notes: 'Gate 3', date: '2026-09-09' }).expect(200);
    expect(notes.body).toMatchObject({ notes: 'Gate 3', date: '2026-09-09', version: 2 });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'UPDATE', entityType: 'ORDER' } });
    expect(audit.summaryParams).toEqual({ orderNumber: 1, fields: ['date', 'notes'] });
    expect(audit.before).toEqual({ date: TODAY, notes: null });

    const stale = await patch(admin, created.id, { version: 1, notes: 'late' }).expect(409);
    expect(stale.body).toMatchObject({ error: { code: 'VERSION_CONFLICT', details: { currentVersion: 2 } } });

    await recordPayment(app, admin, { orderId: created.id, amount: 10_000, date: '2026-09-10' });
    const afterPayment = await patch(admin, created.id, { version: 3, date: TODAY });
    expect(afterPayment.body).toMatchObject({
      error: { code: 'ORDER_DATE_AFTER_ACTIVITY', details: { earliestActivityDate: '2026-09-10' } },
    });
    const frozen = await patch(admin, created.id, { version: 3, lines: [{ itemId: item.id, quantity: 90 }] });
    expect(frozen.body).toMatchObject({ error: { code: 'ORDER_HAS_ACTIVITY' } });
    await patch(admin, created.id, { version: 3, notes: 'Paid in part' }).expect(200);
  });

  it('prints a receipt: six lines in halves, more a page per copy, the total on the last one (A15, Q150)', async () => {
    const items = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        createItem(app, admin, { name: `Pallet ${String(index + 1).padStart(2, '0')}`, depositPrice: 100, stock: 5 }),
      ),
    );
    const receiptOf = async (count: number): Promise<ReceiptDto> => {
      const order = await createOrder(app, admin, {
        customerId: (await createCustomer(app, admin, { name: `Customer ${count}`, phone: `0750000${1000 + count}` }))
          .id,
        driverId: driver.id,
        date: TODAY,
        lines: items.slice(0, count).map((each) => ({ itemId: each.id, quantity: 2 })),
      });
      return (await http().get(`/api/orders/${order.id}/receipt`).set(asUser(admin)).expect(200)).body as ReceiptDto;
    };

    const six = await receiptOf(6);
    expect(six).toMatchObject({
      orderNumber: 1,
      orderNumberDisplay: '000001',
      date: TODAY,
      printedOn: TODAY,
      paymentType: 'LENT',
      depositTotal: 1_200,
      factory: { name: 'Pallet Factory', logoUrl: null },
      driver: { name: driver.name, carNumber: driver.carNumber },
      layout: 'halves',
      rowsPerCopy: 6,
      older: null,
    });
    expect(six.sheets.map((sheet) => [sheet.sheetCount, sheet.rows.length, sheet.showTotal])).toEqual([[1, 6, true]]);
    expect(six.sheets[0]?.rows[0]).toEqual({
      kind: 'line',
      no: 1,
      itemName: 'Pallet 01',
      quantity: 2,
      unitDeposit: 100,
      lineTotal: 200,
      returnedAccepted: 0,
      returnedDamaged: 0,
      outQuantity: 2,
    });

    const thirty = await receiptOf(30);
    expect(thirty).toMatchObject({ layout: 'pages', rowsPerCopy: 27, depositTotal: 6_000 });
    expect(
      thirty.sheets.map((sheet) => [sheet.sheetNumber, sheet.sheetCount, sheet.rows.length, sheet.showTotal]),
    ).toEqual([
      [1, 2, 27, false],
      [2, 2, 3, true],
    ]);
    expect(thirty.sheets[1]?.rows.map((row) => ('no' in row ? row.no : null))).toEqual([28, 29, 30]);
  });

  it("lists under the order the customer's earlier orders' pallets still out, with the totals (Q150)", async () => {
    const other = await createItem(app, admin, { name: 'Plastic pallet', depositPrice: 500, stock: 50 });
    const earlier = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: '2026-09-02',
      lines: [
        { itemId: item.id, quantity: 20 },
        { itemId: other.id, quantity: 4 },
      ],
    });
    const [earlierPallets, earlierPlastic] = earlier.lines;
    if (!earlierPallets || !earlierPlastic) throw new Error('the earlier order has two lines');
    // All of the plastic pallets came back: that line is not listed. Of the 20 others, 15 are still out.
    await recordReturn(app, admin, {
      orderId: earlier.id,
      date: '2026-09-05',
      lines: [
        { orderLineId: earlierPallets.id, acceptedQuantity: 4, damagedQuantity: 1 },
        { orderLineId: earlierPlastic.id, acceptedQuantity: 4 },
      ],
    });
    const cancelled = await order100('LENT');
    await cancel(admin, cancelled.id, cancelled.version).expect(200);
    const otherCustomer = await createCustomer(app, admin, { name: 'Baban Cement', phone: '07502223344' });
    await order100('LENT', otherCustomer.id);

    const order = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: TODAY,
      lines: [{ itemId: item.id, quantity: 10 }],
    });
    // Made after the order: not on its receipt, nor on a reprint.
    await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: TODAY,
      lines: [{ itemId: other.id, quantity: 1 }],
    });

    const receipt = (await http().get(`/api/orders/${order.id}/receipt`).set(asUser(admin)).expect(200))
      .body as ReceiptDto;
    expect(receipt).toMatchObject({
      layout: 'halves',
      depositTotal: 10_000,
      older: { outValue: 15_000, allOutValue: 25_000, combinedTotal: 25_000 },
    });
    expect(receipt.sheets[0]?.rows).toEqual([
      expect.objectContaining({ kind: 'line', no: 1, quantity: 10, lineTotal: 10_000 }),
      { kind: 'olderHeading' },
      // Only what is still out of it (Q158): no quantity, returns or damage of the earlier order; this order's 10 of
      // the same item and price beside it (Q178).
      {
        kind: 'older',
        no: 2,
        itemName: 'Pallet 120×100',
        unitDeposit: 1_000,
        earlierQuantity: 15,
        orderQuantity: 10,
        allQuantity: 25,
        earlierValue: 15_000,
        allValue: 25_000,
      },
    ]);

    // The earliest order has nothing earlier to list.
    const first = (await http().get(`/api/orders/${earlier.id}/receipt`).set(asUser(admin)).expect(200))
      .body as ReceiptDto;
    expect(first.older).toBeNull();
    expect(first.sheets[0]?.rows.map((row) => row.kind)).toEqual(['line', 'line']);
  });

  it('adds up what is still out per item, an item at another price on its own row, this order’s too (Q158, Q178)', async () => {
    const plastic = await createItem(app, admin, { name: 'Plastic pallet', depositPrice: 500, stock: 50 });
    const earlier = (lines: { itemId: number; quantity: number; unitDeposit?: number }[]) =>
      createOrder(app, admin, { customerId: customer.id, driverId: driver.id, date: '2026-09-02', lines });
    // Plastic first, so the rows keep the order each item first appears in, not the item's id.
    await earlier([
      { itemId: plastic.id, quantity: 3 },
      { itemId: item.id, quantity: 10 },
    ]);
    const second = await earlier([{ itemId: item.id, quantity: 7 }]);
    await earlier([{ itemId: item.id, quantity: 2, unitDeposit: 1_200 }]);
    const [secondLine] = second.lines;
    if (!secondLine) throw new Error('the second order has a line');
    await recordReturn(app, admin, {
      orderId: second.id,
      date: '2026-09-05',
      lines: [{ orderLineId: secondLine.id, acceptedQuantity: 2, damagedQuantity: 1 }],
    });

    // This order: three at a price no earlier order has, and two plastic all back (one of the same item and price
    // joining the earlier row is the test above).
    const order = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: TODAY,
      lines: [
        { itemId: item.id, quantity: 3, unitDeposit: 900 },
        { itemId: plastic.id, quantity: 2 },
      ],
    });
    const plasticLine = order.lines[1];
    if (!plasticLine) throw new Error('the order has a plastic line');
    await recordReturn(app, admin, {
      orderId: order.id,
      date: TODAY,
      lines: [{ orderLineId: plasticLine.id, acceptedQuantity: 2 }],
    });
    const receipt = (await http().get(`/api/orders/${order.id}/receipt`).set(asUser(admin)).expect(200))
      .body as ReceiptDto;

    expect(receipt.sheets[0]?.rows.slice(2)).toEqual([
      { kind: 'olderHeading' },
      // Nothing of this order's plastic is out, so its row is the earlier orders' alone.
      {
        kind: 'older',
        no: 3,
        itemName: 'Plastic pallet',
        unitDeposit: 500,
        earlierQuantity: 3,
        orderQuantity: 0,
        allQuantity: 3,
        earlierValue: 1_500,
        allValue: 1_500,
      },
      // 10 of the first order and the 4 of 7 the second still has out, at the same price: one row.
      {
        kind: 'older',
        no: 4,
        itemName: 'Pallet 120×100',
        unitDeposit: 1_000,
        earlierQuantity: 14,
        orderQuantity: 0,
        allQuantity: 14,
        earlierValue: 14_000,
        allValue: 14_000,
      },
      {
        kind: 'older',
        no: 5,
        itemName: 'Pallet 120×100',
        unitDeposit: 1_200,
        earlierQuantity: 2,
        orderQuantity: 0,
        allQuantity: 2,
        earlierValue: 2_400,
        allValue: 2_400,
      },
      // This order's three at a price no earlier order has: a row after them, with nothing earlier.
      {
        kind: 'older',
        no: 6,
        itemName: 'Pallet 120×100',
        unitDeposit: 900,
        earlierQuantity: 0,
        orderQuantity: 3,
        allQuantity: 3,
        earlierValue: 0,
        allValue: 2_700,
      },
    ]);
    expect(receipt.older).toEqual({ outValue: 17_900, allOutValue: 20_600, combinedTotal: 21_600 });
  });

  it('prints on each receipt line what came back of it, and forgets a deleted return (Q134)', async () => {
    const other = await createItem(app, admin, { name: 'Plastic pallet', depositPrice: 500, stock: 50 });
    const order = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: TODAY,
      lines: [
        { itemId: item.id, quantity: 10 },
        { itemId: other.id, quantity: 4 },
      ],
    });
    const [first, second] = order.lines;
    if (!first || !second) throw new Error('the order has two lines');
    const returned = async (): Promise<number[][]> => {
      const receipt = (await http().get(`/api/orders/${order.id}/receipt`).set(asUser(admin)).expect(200))
        .body as ReceiptDto;
      return (receipt.sheets[0]?.rows ?? []).flatMap((row) =>
        row.kind === 'line' ? [[row.quantity, row.returnedAccepted, row.returnedDamaged, row.outQuantity]] : [],
      );
    };

    await recordReturn(app, admin, {
      orderId: order.id,
      date: TODAY,
      lines: [{ orderLineId: first.id, acceptedQuantity: 6, damagedQuantity: 1 }],
    });
    const mistaken = await recordReturn(app, admin, {
      orderId: order.id,
      date: TODAY,
      lines: [{ orderLineId: second.id, acceptedQuantity: 4 }],
    });
    expect(await returned()).toEqual([
      [10, 6, 1, 3],
      [4, 4, 0, 0],
    ]);

    await http().delete(`/api/returns/${mistaken}`).set(asUser(admin)).expect(200);
    expect(await returned()).toEqual([
      [10, 6, 1, 3],
      [4, 0, 0, 4],
    ]);
  });

  it('lists the money ledger across orders by effective date, with its filters', async () => {
    const baban = await createCustomer(app, admin, { name: 'Baban Cement', phone: '07502223344' });
    const cash = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: '2026-09-05',
      paymentType: 'CASH',
      lines: [{ itemId: item.id, quantity: 10 }],
    });
    const lent = await createOrder(app, admin, {
      customerId: baban.id,
      driverId: driver.id,
      date: '2026-09-06',
      lines: [{ itemId: item.id, quantity: 20 }],
    });
    await recordPayment(app, admin, { orderId: lent.id, amount: 5_000, date: '2026-09-08' });
    const gone = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: '2026-09-07',
      paymentType: 'CASH',
      lines: [{ itemId: item.id, quantity: 1 }],
    });
    await cancel(admin, gone.id, 1).expect(200);

    const list = async (query: string): Promise<LedgerEntryDto[]> =>
      ((await http().get(`/api/ledger-entries${query}`).set(asUser(admin)).expect(200)).body as PageDto<LedgerEntryDto>)
        .items;
    const shape = (rows: LedgerEntryDto[]): [string, number, string][] =>
      rows.map((row) => [row.type, row.amount, row.effectiveDate]);

    expect(shape(await list(''))).toEqual([
      ['PAYMENT', 5_000, '2026-09-08'],
      ['PAYMENT', 10_000, '2026-09-05'],
    ]);
    expect(shape(await list('?includeCancelledOrders=true'))).toEqual([
      ['PAYMENT_REVERSAL', 1_000, TODAY],
      ['PAYMENT', 5_000, '2026-09-08'],
      ['PAYMENT', 1_000, '2026-09-07'],
      ['PAYMENT', 10_000, '2026-09-05'],
    ]);
    expect(shape(await list(`?customerId=${baban.id}`))).toEqual([['PAYMENT', 5_000, '2026-09-08']]);
    expect(shape(await list(`?orderId=${cash.id}`))).toEqual([['PAYMENT', 10_000, '2026-09-05']]);
    expect(shape(await list('?includeCancelledOrders=true&type=PAYMENT_REVERSAL'))).toHaveLength(1);
    // The automatic payment has no date of its own and is found by its order's.
    expect(shape(await list('?dateFrom=2026-09-05&dateTo=2026-09-05'))).toEqual([['PAYMENT', 10_000, '2026-09-05']]);
    expect(shape(await list('?sort=amount'))).toEqual([
      ['PAYMENT', 5_000, '2026-09-08'],
      ['PAYMENT', 10_000, '2026-09-05'],
    ]);
    await http().get('/api/ledger-entries?type=PAYMENT,BOGUS').set(asUser(admin)).expect(400);
    await http().get('/api/ledger-entries?dateFrom=2026-09-09&dateTo=2026-09-01').set(asUser(admin)).expect(400);
  });
});

describe('orders under concurrency, and idempotency over time and users (I8, I9, I10)', () => {
  const clock = new FixedClock(NOW);
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;
  let driver: DriverDto;

  beforeAll(async () => {
    app = await createTestApp({ clock });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  beforeEach(async () => {
    clock.set(NOW);
    await resetDatabase();
    admin = await login(app);
    driver = await createDriver(app, admin);
  });

  const post = (session: Session, body: Record<string, unknown>, key: string = randomUUID()): request.Test =>
    request(app.getHttpServer()).post('/api/orders').set(asUser(session)).set('Idempotency-Key', key).send(body);
  const body = (customerId: number, itemId: number, quantity: number): Record<string, unknown> => ({
    customerId,
    driverId: driver.id,
    date: TODAY,
    paymentType: 'LENT',
    lines: [{ itemId, quantity }],
  });

  it('I8 — two orders racing for the last of a credit limit or of the stock: one wins, one is refused', async () => {
    const item = await createItem(app, admin, { depositPrice: 1_000, stock: 500 });
    const limited = await createCustomer(app, admin, { phone: '07509998877', creditLimit: 100_000 });
    const byCredit = await Promise.all([
      post(admin, body(limited.id, item.id, 60)),
      post(admin, body(limited.id, item.id, 60)),
    ]);
    expect(byCredit.map((response) => response.status).sort()).toEqual([201, 409]);

    const scarce = await createItem(app, admin, { name: 'Scarce pallet', stock: 10 });
    const open = await createCustomer(app, admin, { name: 'Open Cement', phone: '07508887766' });
    const byStock = await Promise.all([
      post(admin, body(open.id, scarce.id, 7)),
      post(admin, body(open.id, scarce.id, 7)),
    ]);
    expect(byStock.map((response) => response.status).sort()).toEqual([201, 409]);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: scarce.id } })).quantityOnHand).toBe(3);
  });

  it('I8, I9 — twenty orders at once on shared rows all complete, numbered exactly 1 to 20', async () => {
    const items = [
      await createItem(app, admin, { name: 'A', stock: 500 }),
      await createItem(app, admin, { name: 'B', stock: 500 }),
    ];
    const customers = [
      await createCustomer(app, admin, { name: 'One', phone: '07501000001' }),
      await createCustomer(app, admin, { name: 'Two', phone: '07501000002' }),
      await createCustomer(app, admin, { name: 'Three', phone: '07501000003' }),
    ];

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        post(admin, {
          customerId: customers[index % 3]?.id,
          driverId: driver.id,
          date: TODAY,
          paymentType: index % 2 === 0 ? 'CASH' : 'LENT',
          // Lines in both orders across requests: items are locked by ascending id whatever the line order.
          lines:
            index % 2 === 0
              ? [
                  { itemId: items[0]?.id, quantity: 1 },
                  { itemId: items[1]?.id, quantity: 1 },
                ]
              : [
                  { itemId: items[1]?.id, quantity: 1 },
                  { itemId: items[0]?.id, quantity: 1 },
                ],
        }),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual(Array.from({ length: 20 }, () => 201));
    const numbers = (await prisma.order.findMany({ select: { orderNumber: true } })).map((order) => order.orderNumber);
    expect(numbers.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect((await prisma.orderCounter.findUniqueOrThrow({ where: { id: 1 } })).lastNumber).toBe(20);
    expect(await findLedgerDiscrepancies(prisma)).toEqual([]);
  }, 30_000);

  it('I9 — an order refused by the credit limit uses no number', async () => {
    const item = await createItem(app, admin, { depositPrice: 1_000, stock: 500 });
    const limited = await createCustomer(app, admin, { phone: '07509998877', creditLimit: 1_000 });
    await post(admin, body(limited.id, item.id, 5)).expect(409);

    const open = await createCustomer(app, admin, { name: 'Open Cement', phone: '07508887766' });
    const created = await post(admin, body(open.id, item.id, 5)).expect(201);
    expect((created.body as OrderDetailDto).orderNumber).toBe(1);
  });

  it('I10 — a key is kept for 24 hours and belongs to its user', async () => {
    const item = await createItem(app, admin, { stock: 500 });
    const customer = await createCustomer(app, admin);
    const clerk = await createEmployee(
      app,
      ['orders.view', 'orders.create', 'customers.view', 'drivers.view', 'items.view'],
      'clerk',
    );
    const session = await login(app, clerk.username, EMPLOYEE_PASSWORD);
    const key = randomUUID();

    await post(admin, body(customer.id, item.id, 5), key).expect(201);
    const otherUser = await post(session, body(customer.id, item.id, 5), key).expect(201);
    expect(otherUser.headers['idempotency-replayed']).toBeUndefined();

    clock.advance(24 * 60 * 60 * 1000 + 1);
    // The token of the morning has expired by tomorrow; the day's first request signs in again.
    admin = await login(app);
    const nextDay = await post(admin, body(customer.id, item.id, 5), key).expect(201);
    expect(nextDay.headers['idempotency-replayed']).toBeUndefined();
    expect(await prisma.order.count()).toBe(3);
  });
});
