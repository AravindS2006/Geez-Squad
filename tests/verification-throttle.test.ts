import { expect, it } from 'vitest';
import {
  claimVerificationEmail,
  releaseVerificationEmail,
  VERIFICATION_EMAIL_WINDOW_MS,
} from '../src/lib/verification-throttle';

// Behaves like the RateLimit table: unique key on insert, single-row conditional update.
function fakeStore() {
  const rows = new Map<string, { count: number; lastRequest: bigint }>();
  return {
    rows,
    async create({ data }: { data: { key: string; count: number; lastRequest: bigint } }) {
      await Promise.resolve();
      if (rows.has(data.key))
        throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      rows.set(data.key, { count: data.count, lastRequest: data.lastRequest });
    },
    async updateMany({
      where,
      data,
    }: {
      where: { key: string; lastRequest: { lt: bigint } | bigint };
      data: { count?: { increment: number }; lastRequest: bigint };
    }) {
      await Promise.resolve();
      const row = rows.get(where.key);
      const match =
        row &&
        (typeof where.lastRequest === 'bigint'
          ? row.lastRequest === where.lastRequest
          : row.lastRequest < where.lastRequest.lt);
      if (!row || !match) return { count: 0 };
      row.lastRequest = data.lastRequest;
      if (data.count) row.count += data.count.increment;
      return { count: 1 };
    },
  };
}

it('lets only one of several simultaneous sends through', async () => {
  const store = fakeStore();
  const results = await Promise.all(
    [0, 1, 2, 3].map(() => claimVerificationEmail(store, 'user-1', 1_000_000)),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
});

it('skips a second send inside the window and allows one after it', async () => {
  const store = fakeStore();
  const t0 = 1_000_000;
  expect(await claimVerificationEmail(store, 'user-1', t0)).toBe(true);
  expect(await claimVerificationEmail(store, 'user-1', t0 + 5_000)).toBe(false);
  expect(await claimVerificationEmail(store, 'user-1', t0 + VERIFICATION_EMAIL_WINDOW_MS + 1)).toBe(
    true,
  );
});

it('keeps users independent', async () => {
  const store = fakeStore();
  expect(await claimVerificationEmail(store, 'user-1', 1)).toBe(true);
  expect(await claimVerificationEmail(store, 'user-2', 1)).toBe(true);
});

it('releases the window after a failed delivery so a retry can send', async () => {
  const store = fakeStore();
  const t0 = 1_000_000;
  expect(await claimVerificationEmail(store, 'user-1', t0)).toBe(true);
  await releaseVerificationEmail(store, 'user-1', t0);
  expect(await claimVerificationEmail(store, 'user-1', t0 + 1_000)).toBe(true);
});

it('does not release a newer claim', async () => {
  const store = fakeStore();
  const t0 = 1_000_000;
  await claimVerificationEmail(store, 'user-1', t0);
  const later = t0 + VERIFICATION_EMAIL_WINDOW_MS + 1;
  await claimVerificationEmail(store, 'user-1', later);
  await releaseVerificationEmail(store, 'user-1', t0);
  expect(await claimVerificationEmail(store, 'user-1', later + 1_000)).toBe(false);
});

it('rethrows database errors other than a duplicate key', async () => {
  const store = fakeStore();
  store.create = async () => {
    throw new Error('database offline');
  };
  await expect(claimVerificationEmail(store, 'user-1', 1)).rejects.toThrow('database offline');
});
