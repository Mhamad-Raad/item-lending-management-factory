import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import type { GrantablePermissionKey } from '@pallet/shared';
import { ARGON2_OPTIONS } from '../../src/modules/auth/password.constants';
import { PrismaService } from '../../src/prisma/prisma.service';

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
