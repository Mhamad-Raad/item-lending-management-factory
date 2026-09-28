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

/**
 * Prisma codes for a database that cannot be reached or cannot serve right now: server unreachable
 * (P1001), timed out (P1002), connection closed (P1017), no pool connection in time (P2024), and an
 * interactive transaction that could not start or expired while waiting (P2028).
 */
const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P1017', 'P2024', 'P2028']);
/** What the pg driver adapter reports for the same conditions (a raw query answers P2010 with these). */
const UNAVAILABLE_ADAPTER_KINDS = new Set([
  'DatabaseNotReachable',
  'ConnectionClosed',
  'SocketTimeout',
  'TooManyConnections',
]);
/**
 * PostgreSQL SQLSTATEs of the same kind: connection exceptions (class 08), a full disk (53100: the
 * write fails, reads still work, and it lasts until someone frees space), too many connections
 * (53300), and a server shutting down, crashing or still starting (57P01, 57P02, 57P03).
 */
const UNAVAILABLE_SQLSTATE = /^(08...|53100|53300|57P0[123])$/;
/** Socket errors and the pg pool's own messages when the error reaches us unwrapped. */
const UNAVAILABLE_SOCKET_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE']);
const UNAVAILABLE_MESSAGE =
  /timeout exceeded when trying to connect|Connection terminated|Client has encountered a connection error|the database system is (starting up|shutting down|in recovery mode)/i;

interface ErrorShape {
  code?: unknown;
  name?: unknown;
  message?: unknown;
  cause?: unknown;
  meta?: { driverAdapterError?: { cause?: AdapterCause } };
}

interface AdapterCause {
  kind?: unknown;
  code?: unknown;
  originalCode?: unknown;
}

function adapterCauseUnavailable(cause: AdapterCause | undefined): boolean {
  if (!cause) return false;
  if (typeof cause.kind === 'string' && UNAVAILABLE_ADAPTER_KINDS.has(cause.kind)) return true;
  const sqlState = cause.originalCode ?? cause.code;
  return typeof sqlState === 'string' && UNAVAILABLE_SQLSTATE.test(sqlState);
}

/**
 * True when an error means the database is out of reach or overloaded — a condition of the
 * moment, answered 503 `SERVICE_UNAVAILABLE` — rather than a bug. Walks the `cause` chain, since
 * the driver's error may arrive wrapped. A wrong password or a missing database is not transient
 * and stays a 500.
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const shape = current as ErrorShape;
    if (typeof shape.code === 'string') {
      if (UNAVAILABLE_PRISMA_CODES.has(shape.code) || UNAVAILABLE_SOCKET_CODES.has(shape.code)) return true;
      if (UNAVAILABLE_SQLSTATE.test(shape.code)) return true;
    }
    if (adapterCauseUnavailable(shape.meta?.driverAdapterError?.cause)) return true;
    if (shape.name === 'DriverAdapterError' && adapterCauseUnavailable(shape.cause as AdapterCause)) return true;
    if (typeof shape.message === 'string' && UNAVAILABLE_MESSAGE.test(shape.message)) return true;
    current = shape.cause;
  }
  return false;
}
