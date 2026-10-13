import { expect, it } from 'vitest';
import { loginDestination } from '../src/lib/login-destination';
it('preserves a shared session destination', () => {
  expect(loginDestination('/studio/abc-123_test')).toBe('/studio/abc-123_test');
});
it('rejects external, encoded, and traversal destinations', () => {
  for (const value of [
    null,
    'https://example.com',
    '//example.com',
    '/\\example.com',
    '/studio/../login',
    '/studio/%2Fexample.com',
    '/studio/id?next=elsewhere',
    'javascript:alert(1)',
  ])
    expect(loginDestination(value)).toBe('/app');
});
