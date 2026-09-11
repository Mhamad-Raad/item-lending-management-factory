import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './prisma-errors';

const USERNAME = { index: 'users_username_key', columns: ['username'] };

describe('isUniqueViolation', () => {
  it('recognises the shape the pg driver adapter produces', () => {
    const error = {
      code: 'P2002',
      meta: {
        modelName: 'User',
        driverAdapterError: {
          cause: { originalCode: '23505', constraint: { index: 'users_username_key' }, table: 'users' },
        },
      },
    };

    expect(isUniqueViolation(error, USERNAME)).toBe(true);
  });

  it('recognises the column list the classic engine produces', () => {
    expect(isUniqueViolation({ code: 'P2002', meta: { target: ['username'] } }, USERNAME)).toBe(true);
    expect(isUniqueViolation({ code: 'P2002', meta: { target: 'users_username_key' } }, USERNAME)).toBe(true);
  });

  it('does not claim a violation of a different constraint, or a different error', () => {
    expect(isUniqueViolation({ code: 'P2002', meta: { target: ['phone'] } }, USERNAME)).toBe(false);
    expect(
      isUniqueViolation(
        { code: 'P2002', meta: { driverAdapterError: { cause: { constraint: { index: 'items_name_key' } } } } },
        USERNAME,
      ),
    ).toBe(false);
    expect(isUniqueViolation({ code: 'P2025' }, USERNAME)).toBe(false);
    expect(isUniqueViolation(new Error('boom'), USERNAME)).toBe(false);
  });
});
