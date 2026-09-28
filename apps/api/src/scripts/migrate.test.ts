import { describe, expect, it } from 'vitest';
import { adminPasswordProblem } from './migrate';

/** Q120: the first admin is never seeded with a public, placeholder or policy-failing password. */
describe('adminPasswordProblem', () => {
  it('refuses the .env.example placeholder everywhere, in any case', () => {
    for (const env of ['production', 'development', undefined]) {
      expect(adminPasswordProblem('change-me-min-10-chars', 'admin', env)).toMatch(/placeholder/);
      expect(adminPasswordProblem('My-CHANGE-ME-password-2026', 'admin', env)).toMatch(/placeholder/);
    }
  });

  it('refuses the development, CI and e2e values under production only', () => {
    for (const published of ['admin-dev-password', 'ci-admin-password-123', 'e2e-admin-password-2026']) {
      expect(adminPasswordProblem(published, 'admin', 'production')).toMatch(/published in the repository/);
      expect(adminPasswordProblem(published, 'admin', 'development')).toBeNull();
    }
  });

  it('applies the login password policy: length, the common list and the username', () => {
    expect(adminPasswordProblem('short', 'admin', 'production')).toBe('must be at least 10 characters');
    expect(adminPasswordProblem('x'.repeat(129), 'admin', 'production')).toBe('must be at most 128 characters');
    expect(adminPasswordProblem('password123', 'admin', 'production')).toMatch(/commonly used/);
    expect(adminPasswordProblem('factory-owner', 'factory-owner', 'production')).toMatch(/equals ADMIN_USERNAME/);
  });

  it('accepts a long random password', () => {
    expect(adminPasswordProblem('9f2c7e41b0d85a36', 'admin', 'production')).toBeNull();
  });
});
