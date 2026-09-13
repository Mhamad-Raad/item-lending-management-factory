import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { businessDateToDb, type CustomerDto, type DriverDto, type ItemDto, type OrderDetailDto } from '@pallet/shared';
import request from 'supertest';
import argon2 from 'argon2';
import type { GrantablePermissionKey } from '@pallet/shared';
import { ARGON2_OPTIONS } from '../../src/modules/auth/password.constants';
import { PrismaService } from '../../src/prisma/prisma.service';
import { asUser, type Session } from './auth';

export const EMPLOYEE_PASSWORD = 'employee-test-password';

let employeeHash: string | undefined;

export interface CreatedUser {
  id: number;
  username: string;
  password: string;
}

/**
 * Creates a user straight in the database rather than through `POST /api/users`: the API sets
 * `mustChangePassword`, which would block every route a permission test wants to exercise.
 * The hash is computed once — Argon2 is deliberately slow.
 */
export async function createUser(
  app: INestApplication,
  options: {
    username: string;
    role?: 'ADMIN' | 'EMPLOYEE';
    permissions?: readonly GrantablePermissionKey[];
    isActive?: boolean;
    mustChangePassword?: boolean;
  },
): Promise<CreatedUser> {
  employeeHash ??= await argon2.hash(EMPLOYEE_PASSWORD, ARGON2_OPTIONS);

  const user = await app.get(PrismaService).user.create({
    data: {
      username: options.username,
      displayName: options.username,
      passwordHash: employeeHash,
      role: options.role ?? 'EMPLOYEE',
      isActive: options.isActive ?? true,
      mustChangePassword: options.mustChangePassword ?? false,
      permissions: { create: (options.permissions ?? []).map((permissionKey) => ({ permissionKey })) },
    },
  });

  return { id: user.id, username: user.username, password: EMPLOYEE_PASSWORD };
}

export function createEmployee(
  app: INestApplication,
  permissions: readonly GrantablePermissionKey[] = [],
  username = 'employee',
): Promise<CreatedUser> {
  return createUser(app, { username, permissions });
}

/**
 * Creates an item through `POST /api/items`, with a first batch when `stock` is given, so the stock
 * arrives the way it does in production: as a batch and its ledger row.
 */
export async function createItem(
  app: INestApplication,
  session: Session,
  options: { name?: string; depositPrice?: number; stock?: number; minStock?: number | null } = {},
): Promise<ItemDto> {
  const response = await request(app.getHttpServer())
    .post('/api/items')
    .set(asUser(session))
    .send({
      name: options.name ?? 'Euro pallet',
      depositPrice: options.depositPrice ?? 1_000,
      minStock: options.minStock ?? null,
      ...(options.stock ? { initialBatch: { date: '2026-09-01', quantity: options.stock, unitCost: 700 } } : {}),
    })
    .expect(201);
  return response.body as ItemDto;
}

/** Creates a customer through `POST /api/customers`; a phone another customer holds needs `confirm`. */
export async function createCustomer(
  app: INestApplication,
  session: Session,
  options: {
    name?: string;
    phone?: string;
    altPhone?: string | null;
    creditLimit?: number | null;
    confirm?: boolean;
  } = {},
): Promise<CustomerDto> {
  const response = await request(app.getHttpServer())
    .post('/api/customers')
    .set(asUser(session))
    .send({
      name: options.name ?? 'Kurdistan Cement',
      phone: options.phone ?? '07501234567',
      altPhone: options.altPhone ?? null,
      address: 'Erbil, 100 m road',
      creditLimit: options.creditLimit ?? null,
      confirmDuplicatePhone: options.confirm ?? false,
    })
    .expect(201);
  return response.body as CustomerDto;
}

/** Creates a driver through `POST /api/drivers`. */
export async function createDriver(
  app: INestApplication,
  session: Session,
  options: { name?: string; phone?: string; carNumber?: string } = {},
): Promise<DriverDto> {
  const response = await request(app.getHttpServer())
    .post('/api/drivers')
    .set(asUser(session))
    .send({
      name: options.name ?? 'Karwan Aziz',
      phone: options.phone ?? '07701112233',
      carNumber: options.carNumber ?? 'Erbil 12 A 34567',
    })
    .expect(201);
  return response.body as DriverDto;
}

/**
 * Writes an order and its lines straight into the database, with the maintained totals a real order
 * would carry — including returned pallets and amounts owed, which `createOrder` cannot produce
 * until returns and payments exist (M4). It writes no stock movements, so the database does not
 * reconcile: a file that uses it calls `skipReconciliation`. Everything else uses `createOrder`.
 */
export async function insertOrder(
  app: INestApplication,
  options: {
    customerId: number;
    driverId: number;
    date?: string;
    status?: 'OPEN' | 'SETTLED';
    cancelled?: boolean;
    owed?: number;
    held?: number;
    lines: { itemId: number; quantity: number; unitDeposit: number; returned?: number }[];
  },
): Promise<{ id: number; orderNumber: number }> {
  const prisma = app.get(PrismaService);
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' }, orderBy: { id: 'asc' } });
  const last = await prisma.order.aggregate({ _max: { orderNumber: true } });
  const lines = options.lines.map((line) => {
    const outQuantity = line.quantity - (line.returned ?? 0);
    return { ...line, outQuantity, returnedAccepted: line.returned ?? 0 };
  });
  const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

  const order = await prisma.order.create({
    data: {
      orderNumber: (last._max.orderNumber ?? 0) + 1,
      customerId: options.customerId,
      driverId: options.driverId,
      date: businessDateToDb(options.date ?? '2026-09-10'),
      paymentType: 'LENT',
      status: options.cancelled ? 'CANCELLED' : (options.status ?? 'OPEN'),
      depositTotal: BigInt(sum(lines.map((line) => line.quantity * line.unitDeposit))),
      owed: BigInt(options.owed ?? 0),
      held: BigInt(options.held ?? 0),
      outQuantityTotal: sum(lines.map((line) => line.outQuantity)),
      outValue: BigInt(sum(lines.map((line) => line.outQuantity * line.unitDeposit))),
      ...(options.cancelled ? { cancelledAt: new Date(), cancelledByUserId: admin.id } : {}),
      createdByUserId: admin.id,
      lines: {
        create: lines.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          unitDeposit: BigInt(line.unitDeposit),
          lineTotal: BigInt(line.quantity * line.unitDeposit),
          returnedAccepted: line.returnedAccepted,
          outQuantity: line.outQuantity,
        })),
      },
    },
  });
  return { id: order.id, orderNumber: order.orderNumber };
}

/** Creates an order through `POST /api/orders`, as the web app does: LENT and dated 2026-09-10 unless told otherwise. */
export async function createOrder(
  app: INestApplication,
  session: Session,
  body: {
    customerId: number;
    driverId: number;
    lines: { itemId: number; quantity: number; unitDeposit?: number }[];
    paymentType?: 'CASH' | 'LENT';
    date?: string;
  },
): Promise<OrderDetailDto> {
  const response = await request(app.getHttpServer())
    .post('/api/orders')
    .set(asUser(session))
    .set('Idempotency-Key', randomUUID())
    .send({ paymentType: 'LENT', date: '2026-09-10', ...body })
    .expect(201);
  return response.body as OrderDetailDto;
}
