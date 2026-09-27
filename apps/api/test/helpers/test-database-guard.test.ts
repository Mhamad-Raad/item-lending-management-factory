import { describe, expect, it } from 'vitest';
import { testDatabaseRefusal, type DatabaseIdentity } from './test-database-guard';

const server = '5434, started 2026-09-27 08:00:00+00';
const at = (database: string, on = server): DatabaseIdentity => ({ database, server: on });

describe('testDatabaseRefusal', () => {
  it('allows a *_test database reached by both URLs outside production', () => {
    expect(testDatabaseRefusal({ nodeEnv: 'test', app: at('pallet_test'), owner: at('pallet_test') })).toBeNull();
    expect(
      testDatabaseRefusal({ nodeEnv: undefined, app: at('pallet_fix_test'), owner: at('pallet_fix_test') }),
    ).toBeNull();
  });

  it('refuses under NODE_ENV=production', () => {
    expect(testDatabaseRefusal({ nodeEnv: 'production', app: at('pallet_test'), owner: at('pallet_test') })).toMatch(
      /NODE_ENV is "production"/,
    );
  });

  it('refuses a database whose name does not end in _test, naming the variable', () => {
    expect(testDatabaseRefusal({ nodeEnv: 'test', app: at('pallet_test'), owner: at('pallet') })).toMatch(
      /DATABASE_TEST_MIGRATE_URL reaches database "pallet"/,
    );
    expect(testDatabaseRefusal({ nodeEnv: 'test', app: at('pallet'), owner: at('pallet_test') })).toMatch(
      /DATABASE_TEST_URL reaches database "pallet"/,
    );
    expect(testDatabaseRefusal({ nodeEnv: 'test', app: at('test'), owner: at('test') })).toMatch(/does not end in/);
  });

  it('refuses two URLs that reach different databases or servers', () => {
    expect(testDatabaseRefusal({ nodeEnv: 'test', app: at('a_test'), owner: at('b_test') })).toMatch(
      /both must name the same test database/,
    );
    expect(
      testDatabaseRefusal({ nodeEnv: 'test', app: at('pallet_test', '5432, started x'), owner: at('pallet_test') }),
    ).toMatch(/both must name the same test database/);
  });
});
