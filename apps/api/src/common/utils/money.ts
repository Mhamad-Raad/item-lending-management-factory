import { ApiError } from '../errors/api-error';

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

/**
 * `quantity × price`, refused when it leaves the safe-integer range (§6.1.3): a total the database
 * could store but TypeScript could not add up exactly. `field` is the price field the user can fix.
 */
export function safeProduct(quantity: number, price: number, field: string): number {
  const product = quantity * price;
  if (!Number.isSafeInteger(product)) {
    throw new ApiError('VALIDATION_FAILED', undefined, [
      { path: field, code: 'too_big', params: { maximum: Number.MAX_SAFE_INTEGER } },
    ]);
  }
  return product;
}
