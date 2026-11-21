import { describe, expect, it } from 'vitest';
import {
  coachInvitationEmail,
  membershipSetupEmail,
  passwordResetEmail,
  verificationEmail,
} from '../src/lib/email-templates';

const url = 'https://app.example.test/api/auth/verify-email?token=abc.def&callbackURL=%2Flogin';
const escaped = url.replace(/&/g, '&amp;');
const hostile = '<img src=x onerror=alert(1)>';

const templates = [
  ['verification', verificationEmail({ name: 'Riya Sharma', url }), 'Verify my email'],
  ['password reset', passwordResetEmail({ name: 'Riya Sharma', url }), 'Reset my password'],
  ['membership setup', membershipSetupEmail({ studioName: 'Core Lab', url }), 'Open Geez Squad'],
  [
    'coach invitation',
    coachInvitationEmail({ studioName: 'Core Lab', url }),
    'Accept in Geez Squad',
  ],
] as const;

describe.each(templates)('%s email', (_name, mail, label) => {
  it('links the button and the fallback to the same URL', () => {
    expect(mail.html).toMatch(new RegExp(`<a href="[^"]+"[^>]*>${label}`));
    expect(mail.html.split(`href="${escaped}"`)).toHaveLength(3);
  });
  it('shares the branded light layout', () => {
    expect(mail.html).toContain('<meta name="color-scheme" content="light">');
    expect(mail.html).toContain('Stronger, together.');
    expect(mail.html).toContain('#bef264');
  });
  it('keeps a plain-text part with the raw link', () => {
    expect(mail.text).toContain(`${label}: ${url}`);
  });
});

it('greets by first name and falls back when there is none', () => {
  expect(verificationEmail({ name: 'Riya Sharma', url }).html).toContain('Hi Riya,');
  expect(passwordResetEmail({ name: '', url }).text.startsWith('Hi there,')).toBe(true);
});

it('states the real expiry of each link', () => {
  expect(verificationEmail({ url }).text).toContain('expires in 1 hour');
  expect(passwordResetEmail({ url }).text).toContain('expires in 1 hour and can be used once');
  expect(coachInvitationEmail({ studioName: 'Core Lab', url }).text).toContain('expires in 7 days');
});

it('escapes user and studio names in the HTML and keeps the subject on one line', () => {
  for (const mail of [
    verificationEmail({ name: hostile, url }),
    membershipSetupEmail({ studioName: hostile, url }),
    coachInvitationEmail({ studioName: `Core\r\nBcc: x@example.test ${hostile}`, url }),
  ]) {
    expect(mail.html).not.toContain('<img');
    expect(mail.subject).not.toMatch(/[\r\n]/);
  }
});
