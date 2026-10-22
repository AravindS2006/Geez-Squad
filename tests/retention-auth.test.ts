import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/security', () => ({
  safeError: () => Response.json({ error: 'Unexpected failure' }, { status: 500 }),
}));
const transaction = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({ db: { $transaction: transaction } }));
import { GET } from '../src/app/api/retention/route';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it('rejects same-character-length multi-byte authorization as 401 instead of throwing', async () => {
  vi.stubEnv('CRON_SECRET', 'x'.repeat(32));
  const response = await GET(
    new Request('http://localhost/api/retention', {
      headers: { authorization: `Bearer ${'é'.repeat(32)}` },
    }),
  );
  expect(response.status).toBe(401);
  expect(transaction).not.toHaveBeenCalled();
});
