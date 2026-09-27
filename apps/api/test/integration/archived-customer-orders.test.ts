import type { INestApplication } from '@nestjs/common';
import type { CustomerDto, DriverDto, ItemDto, OrderDetailDto } from '@pallet/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/common/clock';
import { createTestApp } from '../helpers/app';
import { asUser, login, type Session } from '../helpers/auth';
import { disconnectDatabase, resetDatabase } from '../helpers/db';
import { errorCode } from '../helpers/errors';
import { createCustomer, createDriver, createItem, createOrder, recordReturn } from '../helpers/factories';

const NOW = new Date('2026-09-11T09:00:00Z');
const TODAY = '2026-09-11';

/**
 * Q18/Q78: an archived customer keeps returns, payments and header edits on existing orders, but no
 * more pallets go out to them. A settled order can reopen after its customer is archived (its return
 * is deleted), and its lines then become editable again: a line edit that sends pallets out is refused.
 */
describe('orders of an archived customer (Q18, Q78)', () => {
  let app: INestApplication;
  let admin: Session;
  let item: ItemDto;
  let other: ItemDto;
  let customer: CustomerDto;
  let driver: DriverDto;
  let order: OrderDetailDto;

  beforeAll(async () => {
    app = await createTestApp({ clock: new FixedClock(NOW) });
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const current = async (): Promise<OrderDetailDto> =>
    (await http().get(`/api/orders/${order.id}`).set(asUser(admin)).expect(200)).body as OrderDetailDto;
  const patch = async (body: Record<string, unknown>): Promise<request.Response> =>
    http()
      .patch(`/api/orders/${order.id}`)
      .set(asUser(admin))
      .send({ version: (await current()).version, ...body });

  /** A settled order whose customer is then archived and whose only return is then deleted: OPEN again. */
  beforeEach(async () => {
    await resetDatabase();
    admin = await login(app);
    item = await createItem(app, admin, { name: 'Euro pallet', depositPrice: 1_000, stock: 100 });
    other = await createItem(app, admin, { name: 'Half pallet', depositPrice: 500, stock: 100 });
    customer = await createCustomer(app, admin);
    driver = await createDriver(app, admin);
    order = await createOrder(app, admin, {
      customerId: customer.id,
      driverId: driver.id,
      date: TODAY,
      paymentType: 'LENT',
      lines: [{ itemId: item.id, quantity: 10 }],
    });
    const lineId = order.lines[0]?.id ?? 0;
    const returnId = await recordReturn(app, admin, {
      orderId: order.id,
      date: TODAY,
      lines: [{ orderLineId: lineId, acceptedQuantity: 10 }],
    });
    expect((await current()).status).toBe('SETTLED');
    await http().delete(`/api/customers/${customer.id}?version=${customer.version}`).set(asUser(admin)).expect(200);
    await http().delete(`/api/returns/${returnId}`).set(asUser(admin)).expect(200);
    expect((await current()).status).toBe('OPEN');
  });

  it('refuses an added line with CUSTOMER_ARCHIVED', async () => {
    const response = await patch({
      lines: [
        { itemId: item.id, quantity: 10 },
        { itemId: other.id, quantity: 5 },
      ],
    });
    expect(response.status).toBe(409);
    expect(errorCode(response.body)).toBe('CUSTOMER_ARCHIVED');
    expect((await current()).lines).toHaveLength(1);
  });

  it('refuses a raised quantity with CUSTOMER_ARCHIVED', async () => {
    const raised = await patch({ lines: [{ itemId: item.id, quantity: 11 }] });
    expect(raised.status).toBe(409);
    expect(errorCode(raised.body)).toBe('CUSTOMER_ARCHIVED');
    expect((await current()).lines[0]?.quantity).toBe(10);
  });

  it('still allows a lower quantity and a header edit', async () => {
    const lowered = await patch({ lines: [{ itemId: item.id, quantity: 4 }] });
    expect(lowered.status).toBe(200);
    expect((lowered.body as OrderDetailDto).lines[0]?.quantity).toBe(4);
    const noted = await patch({ notes: 'Customer closed; collecting the rest' });
    expect(noted.status).toBe(200);
  });
});
