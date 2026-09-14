import type { INestApplication } from '@nestjs/common';
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
const HELD_MS = 1_500;

/**
 * Q47: deleting or replacing a return puts pallets back out and raises the customer's out value, which the credit
 * check sums under the customer's lock (§4.4). Both take that lock first, so an order being priced for the same
 * customer cannot miss them.
 */
describe('return changes lock the customer (Q47)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;
  let customerId: number;
  let returnId: number;

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
    const item = await createItem(app, admin, { depositPrice: 1_000, stock: 100 });
    const customer = await createCustomer(app, admin, { creditLimit: 1_000_000 });
    const driver = await createDriver(app, admin);
    const order = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: TODAY,
      paymentType: 'LENT',
      lines: [{ itemId: item.id, quantity: 50 }],
    });
    customerId = customer.id;
    returnId = await recordReturn(app, admin, {
      orderId: order.id,
      date: TODAY,
      lines: [{ orderLineId: order.lines[0]?.id ?? 0, acceptedQuantity: 20 }],
    });
  });

  /** Holds the customer row as an order's credit check would, and reports whether `send` finished meanwhile. */
  async function finishesWhileCustomerHeld(send: () => Promise<{ status: number }>): Promise<boolean> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} FOR UPDATE`;
        locked();
        await held;
      },
      { timeout: 30_000 },
    );
    await lockTaken;
    let finished = false;
    const pending = send().then((response) => {
      finished = true;
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, HELD_MS));
    const finishedWhileHeld = finished;
    release();
    await holder;
    expect([200, 201]).toContain((await pending).status);
    return finishedWhileHeld;
  }

  it('a return deletion waits for the customer', async () => {
    const http = request(app.getHttpServer());
    expect(await finishesWhileCustomerHeld(() => http.delete(`/api/returns/${returnId}`).set(asUser(admin)))).toBe(
      false,
    );
  }, 30_000);

  it('a return replacement waits for the customer', async () => {
    const order = await prisma.palletReturn.findUniqueOrThrow({
      where: { id: returnId },
      include: { lines: true },
    });
    const body = {
      date: TODAY,
      lines: [{ orderLineId: order.lines[0]?.orderLineId ?? 0, acceptedQuantity: 10, damagedQuantity: 0 }],
    };
    const http = request(app.getHttpServer());
    expect(
      await finishesWhileCustomerHeld(() =>
        http.post(`/api/returns/${returnId}/replace`).set(asUser(admin)).send(body),
      ),
    ).toBe(false);
  }, 30_000);
});
