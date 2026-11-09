import { expect, it } from 'vitest';
import { databaseProvider, isSqliteDatabase } from '../src/lib/db-provider';

it('selects PostgreSQL only when explicitly configured', () => {
  expect(databaseProvider({ DATABASE_PROVIDER: 'postgresql' })).toBe('postgresql');
  expect(isSqliteDatabase({ DATABASE_PROVIDER: 'postgresql' })).toBe(false);
  expect(databaseProvider({ DATABASE_PROVIDER: 'sqlite', DATABASE_URL: 'file:./dev.db' })).toBe(
    'sqlite',
  );
  expect(isSqliteDatabase({})).toBe(true);
});
