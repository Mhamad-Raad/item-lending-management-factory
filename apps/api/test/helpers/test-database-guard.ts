import { createPrismaClient } from '../../src/prisma/create-client';
import { Prisma } from '../../src/generated/prisma/client';

/** Where a connection string lands: the database's name and the server that holds it. */
export interface DatabaseIdentity {
  database: string;
  /** Host port and start time: two servers on one machine can both hold a `pallet_test`. */
  server: string;
}

export interface TestDatabaseTargets {
  nodeEnv: string | undefined;
  /** Reached through DATABASE_TEST_URL, the role the application under test connects as. */
  app: DatabaseIdentity;
  /** Reached through DATABASE_TEST_MIGRATE_URL, the owner that migrates and truncates. */
  owner: DatabaseIdentity;
}

/**
 * Why the integration suite must not touch these databases, or null when it may. The suite
 * migrates and truncates every table, so it only runs against a database whose name ends in
 * `_test`, outside production, and only when both URLs reach that same database — otherwise a
 * mistyped `.env` would empty the development (or a restored production) database.
 */
export function testDatabaseRefusal(targets: TestDatabaseTargets): string | null {
  const { nodeEnv, app, owner } = targets;
  if (nodeEnv === 'production') {
    return `NODE_ENV is "production"; the integration suite truncates every table and never runs there`;
  }
  for (const [variable, identity] of [
    ['DATABASE_TEST_MIGRATE_URL', owner],
    ['DATABASE_TEST_URL', app],
  ] as const) {
    if (!identity.database.endsWith('_test')) {
      return `${variable} reaches database "${identity.database}", whose name does not end in "_test"; point it at a scratch test database`;
    }
  }
  if (app.database !== owner.database || app.server !== owner.server) {
    return `DATABASE_TEST_URL reaches "${app.database}" (${app.server}) but DATABASE_TEST_MIGRATE_URL reaches "${owner.database}" (${owner.server}); both must name the same test database`;
  }
  return null;
}

const IDENTITY = Prisma.sql`SELECT current_database() AS database,
  COALESCE(inet_server_port()::text, 'socket') || ', started ' || pg_postmaster_start_time()::text AS server`;

async function identify(url: string): Promise<DatabaseIdentity> {
  const client = createPrismaClient(url);
  try {
    const [row] = await client.$queryRaw<DatabaseIdentity[]>(IDENTITY);
    if (!row) throw new Error('the database did not report its name');
    return row;
  } finally {
    await client.$disconnect();
  }
}

/**
 * Connects through both test URLs and throws, naming the database and the reason, unless the
 * suite may reset it. Run before `migrate deploy` and before the first TRUNCATE of every file.
 */
export async function assertSafeTestDatabase(): Promise<void> {
  const appUrl = process.env.DATABASE_TEST_URL;
  const ownerUrl = process.env.DATABASE_TEST_MIGRATE_URL;
  if (!appUrl) throw new Error('DATABASE_TEST_URL is required to run the integration tests');
  if (!ownerUrl) throw new Error('DATABASE_TEST_MIGRATE_URL is required to run the integration tests');
  const [app, owner] = await Promise.all([identify(appUrl), identify(ownerUrl)]);
  const refusal = testDatabaseRefusal({ nodeEnv: process.env.NODE_ENV, app, owner });
  if (refusal) throw new Error(`Refusing to reset database "${owner.database}": ${refusal}.`);
}
