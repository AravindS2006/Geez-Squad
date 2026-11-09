import { describe, expect, it } from 'vitest';
import { allowedOrigins, isAllowedOrigin } from '../src/lib/origins';

const base = { BETTER_AUTH_URL: 'https://geez-squad.vercel.app/' };
describe('trusted request origins', () => {
  it('accepts only the configured application origin outside previews', () => {
    expect(allowedOrigins(base)).toEqual(['https://geez-squad.vercel.app']);
    const production = {
      ...base,
      VERCEL_ENV: 'production',
      VERCEL_URL: 'geez-squad-abc.vercel.app',
    };
    expect(isAllowedOrigin('https://geez-squad-abc.vercel.app', production)).toBe(false);
    expect(isAllowedOrigin('https://geez-squad.vercel.app', production)).toBe(true);
  });
  it('adds the deployment host only for Vercel preview builds', () => {
    const preview = { ...base, VERCEL_ENV: 'preview', VERCEL_URL: 'geez-squad-abc.vercel.app' };
    expect(isAllowedOrigin('https://geez-squad-abc.vercel.app', preview)).toBe(true);
    expect(isAllowedOrigin('http://geez-squad-abc.vercel.app', preview)).toBe(false);
    expect(isAllowedOrigin(null, preview)).toBe(false);
    expect(allowedOrigins({ ...preview, VERCEL_URL: 'evil.test/path?x=1' })).toEqual([
      'https://geez-squad.vercel.app',
    ]);
  });
  it('falls back to the request URL locally', () => {
    expect(allowedOrigins({}, 'http://127.0.0.1:3000/api/command')).toEqual([
      'http://127.0.0.1:3000',
    ]);
  });
});
