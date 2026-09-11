// Prisma 7 CLI configuration. The CLI (migrate, db execute, studio) connects with the
// MIGRATION role (pallet_owner). The running API connects with DATABASE_URL (pallet_app).
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Local development keeps the single .env at the repository root; in Docker the variables
// come from the compose environment and this is a no-op.
config({ path: '../../.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_MIGRATE_URL ?? '',
  },
});
