import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type ErrorCode } from '@pallet/shared';

/**
 * The bundled common-password list (§10.1 S3), read once. It sits next to the compiled file in
 * `dist/modules/auth/`, put there by the `copy-assets` script.
 */
let commonPasswords: Set<string> | undefined;

function loadCommonPasswords(): Set<string> {
  commonPasswords ??= new Set(
    readFileSync(path.join(__dirname, 'common-passwords.txt'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== ''),
  );
  return commonPasswords;
}

/**
 * Returns the first failing rule, in the order of §6.8.6, or null when the password is acceptable.
 * Length is counted in code points so that non-Latin passwords are not penalised.
 */
export function checkPasswordPolicy(password: string, username: string): ErrorCode | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return 'PASSWORD_TOO_SHORT';
  if (length > PASSWORD_MAX_LENGTH) return 'PASSWORD_TOO_LONG';

  const candidate = password.toLowerCase();
  if (candidate === username.toLowerCase()) return 'PASSWORD_TOO_COMMON';
  if (loadCommonPasswords().has(candidate)) return 'PASSWORD_TOO_COMMON';

  return null;
}
