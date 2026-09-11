/**
 * Money is `bigint` in PostgreSQL and a safe-integer `number` everywhere in TypeScript.
 * Convert at the repository boundary only, and fail loudly instead of losing precision.
 */
export function toSafeMoney(value: bigint | number): number {
  const n = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(n)) throw new Error(`Money value outside the safe integer range: ${String(value)}`);
  return n;
}

export function toDbMoney(value: number): bigint {
  if (!Number.isSafeInteger(value)) throw new Error(`Money value is not a safe integer: ${value}`);
  return BigInt(value);
}
