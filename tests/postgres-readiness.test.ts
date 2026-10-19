import { describe, expect, it, vi } from 'vitest';
import { checkPostgresReadiness } from '../scripts/postgres-readiness.mjs';

const env = {
  NODE_ENV: 'test' as const,
  DATABASE_URL: 'postgresql://test:test@runtime.example/db',
  DIRECT_URL: 'postgresql://test:test@direct.example/db',
};
describe('production schema release gate', () => {
  it('accepts only a successful, explicitly current migration history', () => {
    const run = vi.fn().mockReturnValue({ status: 0, stdout: 'Database schema is up to date!' });
    expect(checkPostgresReadiness(env, run).ok).toBe(true);
    expect(run.mock.calls[0][1]).toContain('status');
    expect(run.mock.calls[0][1]).not.toContain('deploy');
  });
  it('blocks the missing studio migrations and withholds private diagnostics', () => {
    const run = vi.fn().mockReturnValue({
      status: 1,
      stderr:
        'postgresql://private:secret@private.example/db\n20261019000000_studio_operations\n20261019010000_studio_classes',
    });
    const result = checkPostgresReadiness(env, run);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('20261019000000_studio_operations');
    expect(result.message).not.toMatch(/private|secret|postgresql:\/\//);
  });
  it.each([
    { status: 0, stdout: 'Unexpected output' },
    { status: 1, stderr: 'Cannot connect' },
    { status: null, error: new Error('Timed out') },
  ])('fails closed for unexpected status or connection failures', (output) => {
    expect(checkPostgresReadiness(env, vi.fn().mockReturnValue(output)).ok).toBe(false);
  });
  it('does not invoke Prisma without an explicit migration connection', () => {
    const run = vi.fn();
    expect(
      checkPostgresReadiness({ NODE_ENV: 'test', DATABASE_URL: env.DATABASE_URL }, run).ok,
    ).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
