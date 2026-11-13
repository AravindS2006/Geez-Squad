import { afterEach, describe, expect, it, vi } from 'vitest';
import config from '../next.config';
import { buildContentSecurityPolicy, createNonce } from '../src/lib/content-security-policy';

afterEach(() => vi.unstubAllEnvs());

async function staticPolicy(source: string) {
  const group = (await config.headers!()).find((g) => g.source === source)!;
  return group.headers.find((h) => h.key === 'Content-Security-Policy')!.value;
}

describe('LiveKit connection security policy', () => {
  it('allows Cloud regional endpoints for room connection and reconnection', () => {
    const policy = buildContentSecurityPolicy({
      nonce: 'abc',
      livekitUrl: 'wss://geez-squad-test.livekit.cloud',
    });
    expect(policy).toContain('wss://*.livekit.cloud');
    expect(policy).toContain('https://*.livekit.cloud');
    expect(policy).toContain("worker-src 'self' blob:");
  });
  it('keeps a self-hosted installation scoped to its configured host', async () => {
    vi.stubEnv('LIVEKIT_URL', 'wss://video.example.test');
    const policy = await staticPolicy('/api/:path*');
    expect(policy).toContain('wss://video.example.test https://video.example.test');
    expect(policy).not.toContain('*.livekit.cloud');
  });
  it('sends HSTS on every route and keeps CSP out of the catch-all group', async () => {
    const headers = (await config.headers!()).find((group) => group.source === '/(.*)')!.headers;
    expect(headers.find((h) => h.key === 'Strict-Transport-Security')?.value).toBe(
      'max-age=63072000; includeSubDomains',
    );
    // Pages get their nonce policy from src/proxy.ts; a second CSP here would intersect with it.
    expect(headers.find((h) => h.key === 'Content-Security-Policy')).toBeUndefined();
  });
});

describe('nonce content security policy', () => {
  it('allows only nonced scripts on pages, never inline', () => {
    const policy = buildContentSecurityPolicy({ nonce: 'n0nce', livekitUrl: 'wss://x.test' });
    const scriptSrc = policy.split('; ').find((d) => d.startsWith('script-src '))!;
    expect(scriptSrc).toBe("script-src 'self' 'nonce-n0nce' 'strict-dynamic' 'wasm-unsafe-eval'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("media-src 'self' blob:");
  });
  it('gives static worker documents a same-origin policy without inline scripts', async () => {
    const policy = await staticPolicy('/(pose-worker\\.js|sw\\.js|offline\\.html)');
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(policy).not.toContain('strict-dynamic');
    expect(policy.split('; ').find((d) => d.startsWith('script-src'))).not.toContain(
      'unsafe-inline',
    );
  });
  it('adds unsafe-eval only in development', () => {
    expect(buildContentSecurityPolicy({ nonce: 'a', isDev: true })).toContain("'unsafe-eval'");
    expect(buildContentSecurityPolicy({ nonce: 'a' })).not.toContain("'unsafe-eval'");
  });
  it('creates a fresh 128-bit base64 nonce each time', () => {
    const a = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(a);
  });
});
