import argon2 from 'argon2';

/**
 * Argon2id parameters (§10.1 S1). Shared by the password service, the first-run seed and the
 * test factories so every hash in the system is produced with the same cost.
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;
