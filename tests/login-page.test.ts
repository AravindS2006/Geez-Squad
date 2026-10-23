import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ requireUser: vi.fn(), redirect: vi.fn() }));
vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: fixture.redirect }));
vi.mock('@/components/auth-form', () => ({ AuthForm: () => null }));
vi.mock('@/lib/auth', () => ({
  emailPolicy: { testingMode: false, signupEnabled: true, passwordResetEnabled: true },
}));
vi.mock('@/lib/security', () => ({
  requireUser: fixture.requireUser,
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
      public code?: string,
    ) {
      super(message);
    }
  },
}));
import LoginPage from '../src/app/login/page';
import { ApiError } from '../src/lib/security';
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  fixture.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});
it('sends authenticated users away from login and signup to their safe destination', async () => {
  fixture.requireUser.mockResolvedValue({ id: 'existing-user' });
  await expect(
    LoginPage({ searchParams: Promise.resolve({ mode: 'signup', next: '/studio/shared' }) }),
  ).rejects.toThrow('redirect:/studio/shared');
  await expect(
    LoginPage({ searchParams: Promise.resolve({ next: '//example.com' }) }),
  ).rejects.toThrow('redirect:/app');
});
it('retains legacy invitations and handles repeated destination parameters safely', async () => {
  fixture.requireUser.mockResolvedValue({ id: 'existing-user' });
  await expect(
    LoginPage({ searchParams: Promise.resolve({ invite: ['code&next=evil', 'ignored'] }) }),
  ).rejects.toThrow('redirect:/invite?code=code%26next%3Devil');
});
it('leaves missing or expired sessions on the login form', async () => {
  fixture.requireUser.mockRejectedValue(new ApiError(401, 'Expired session'));
  await expect(LoginPage({ searchParams: Promise.resolve({}) })).resolves.toBeDefined();
  expect(fixture.redirect).not.toHaveBeenCalled();
});
it('keeps unverified sessions on verification instead of redirecting in a loop', async () => {
  fixture.requireUser.mockRejectedValue(
    new ApiError(403, 'Verify email', 'EMAIL_VERIFICATION_REQUIRED'),
  );
  const page = await LoginPage({ searchParams: Promise.resolve({ next: '/studio/shared' }) });
  expect(page.props.children.props.verificationRequired).toBe(true);
  expect(fixture.redirect).not.toHaveBeenCalled();
});
it('does not replace an explicit password-reset flow with a session redirect', async () => {
  fixture.requireUser.mockResolvedValue({ id: 'existing-user' });
  await expect(
    LoginPage({ searchParams: Promise.resolve({ token: 'reset-link' }) }),
  ).resolves.toBeDefined();
  expect(fixture.requireUser).not.toHaveBeenCalled();
  expect(fixture.redirect).not.toHaveBeenCalled();
});
it('propagates authentication/database failures to the error boundary', async () => {
  const failure = new Error('Provider unavailable');
  fixture.requireUser.mockRejectedValue(failure);
  await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toBe(failure);
  expect(fixture.redirect).not.toHaveBeenCalled();
});
