import { afterEach, describe, expect, it, vi } from 'vitest';
import config from '../next.config';

afterEach(() => vi.unstubAllEnvs());
describe('LiveKit connection security policy', () => {
  it('allows Cloud regional endpoints for room connection and reconnection', async () => {
    vi.stubEnv('LIVEKIT_URL', 'wss://geez-squad-test.livekit.cloud');
    const headers = await config.headers!();
    const policy = headers
      .find((group) => group.source === '/(.*)')!
      .headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    expect(policy).toContain('wss://*.livekit.cloud');
    expect(policy).toContain('https://*.livekit.cloud');
    expect(policy).toContain("worker-src 'self' blob:");
  });
  it('keeps a self-hosted installation scoped to its configured host', async () => {
    vi.stubEnv('LIVEKIT_URL', 'wss://video.example.test');
    const headers = await config.headers!();
    const policy = headers
      .find((group) => group.source === '/(.*)')!
      .headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    expect(policy).toContain('wss://video.example.test https://video.example.test');
    expect(policy).not.toContain('*.livekit.cloud');
  });
});
