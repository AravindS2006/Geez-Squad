import { expect, it } from 'vitest';
import { accountDestination, loginDestination } from '../src/lib/login-destination';
it('preserves a shared session destination', () => {
  expect(loginDestination('/studio/abc-123_test')).toBe('/studio/abc-123_test');
});
it('preserves an invitation as a query value without allowing it to redirect off-site', () => {
  expect(accountDestination('/studio/session', 'legacy&next=//example.com')).toBe(
    '/invite?code=legacy%26next%3D%2F%2Fexample.com',
  );
  expect(accountDestination('//example.com', null)).toBe('/app');
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
