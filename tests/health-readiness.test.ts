import { afterEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $queryRaw: fixture.query } }));
import { GET } from '../src/app/api/health/route';
afterEach(() => vi.resetAllMocks());
describe('health readiness', () => {
  it('returns healthy for a compatible schema and never exposes query results', async () => {
    fixture.query.mockResolvedValue([]);
    const response = await GET(new Request('http://localhost/api/health'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('reports unavailable instead of healthy when a studio column is missing', async () => {
    fixture.query.mockRejectedValue(
      new Error('Studio.address missing; private connection details'),
    );
    const response = await GET(new Request('http://localhost/api/health'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
