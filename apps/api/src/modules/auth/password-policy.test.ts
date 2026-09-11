import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy } from './password-policy';

describe('checkPasswordPolicy', () => {
  it('accepts a long, unremarkable password', () => {
    expect(checkPasswordPolicy('a-considered-new-password', 'admin')).toBeNull();
  });

  it('reports length before anything else', () => {
    expect(checkPasswordPolicy('short', 'admin')).toBe('PASSWORD_TOO_SHORT');
    expect(checkPasswordPolicy('x'.repeat(129), 'admin')).toBe('PASSWORD_TOO_LONG');
    // A nine-character common password is refused for its length, per the order of §6.8.6.
    expect(checkPasswordPolicy('password1', 'admin')).toBe('PASSWORD_TOO_SHORT');
  });

  it('counts length in code points, not UTF-16 units', () => {
    // Ten Kurdish letters: one code point each, and none of them Latin.
    expect(checkPasswordPolicy('پەنجەرەکان', 'admin')).toBeNull();
  });

  it('refuses a password from the bundled list', () => {
    expect(checkPasswordPolicy('password123', 'admin')).toBe('PASSWORD_TOO_COMMON');
    expect(checkPasswordPolicy('PassWord123', 'admin')).toBe('PASSWORD_TOO_COMMON');
  });

  it('refuses a password equal to the username, whatever its case', () => {
    expect(checkPasswordPolicy('administrator1', 'administrator1')).toBe('PASSWORD_TOO_COMMON');
    expect(checkPasswordPolicy('ADMINISTRATOR1', 'administrator1')).toBe('PASSWORD_TOO_COMMON');
  });
});
