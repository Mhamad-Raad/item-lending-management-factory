/**
 * Prisma reports a unique violation as `P2002`, but the shape depends on the driver: the classic
 * engine fills `meta.target` with the column names, while the pg driver adapter this project uses
 * nests the constraint name under `meta.driverAdapterError`. Endpoints that map a violation to
 * their own error code (`USERNAME_TAKEN`, idempotency replay) name both so that neither driver
 * silently turns a 409 into a 500.
 */
export interface UniqueConstraint {
  /** The index name, as PostgreSQL reports it: `users_username_key`. */
  index: string;
  /** The column names the index covers, as the classic engine reports them. */
  columns: readonly string[];
}

export function isUniqueViolation(error: unknown, constraint: UniqueConstraint): boolean {
  const known = error as {
    code?: string;
    meta?: {
      target?: unknown;
      driverAdapterError?: { cause?: { constraint?: { index?: string }; originalMessage?: string } };
    };
  };
  if (known.code !== 'P2002') return false;

  const target = known.meta?.target;
  if (Array.isArray(target) && target.some((column) => constraint.columns.includes(String(column)))) return true;
  if (typeof target === 'string' && target.includes(constraint.index)) return true;

  const cause = known.meta?.driverAdapterError?.cause;
  return cause?.constraint?.index === constraint.index || (cause?.originalMessage?.includes(constraint.index) ?? false);
}
