import type { INestApplication } from '@nestjs/common';
import type { ItemDto } from '@pallet/shared';
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
