import { describe, expect, it } from 'vitest';
import {
  closedStudioOwner,
  isPlatformOperator,
  operatorEmails,
  reviewOutcome,
  studioOwnershipCommand,
  studioRequestCommand,
} from '../src/lib/studio-lifecycle-policy';
import { deletionBlocker } from '../src/lib/account-deletion-policy';

const env = { PLATFORM_OPERATOR_EMAILS: ' Ops@Example.test, second@example.test\nbad-entry ' };

describe('platform operator allow-list', () => {
  it('parses a comma or whitespace separated, case-insensitive list', () => {
    expect([...operatorEmails(env)]).toEqual(['ops@example.test', 'second@example.test']);
    expect(operatorEmails({}).size).toBe(0);
  });
  it('needs a verified email on the list; nothing else grants it', () => {
    expect(isPlatformOperator({ email: 'OPS@example.test', emailVerified: true }, env)).toBe(true);
    expect(isPlatformOperator({ email: 'ops@example.test', emailVerified: false }, env)).toBe(
      false,
    );
    expect(isPlatformOperator({ email: 'coach@example.test', emailVerified: true }, env)).toBe(
      false,
    );
    expect(isPlatformOperator({ email: 'ops@example.test', emailVerified: true }, {})).toBe(false);
  });
});

describe('studio request review', () => {
  it('applies once and treats a repeated identical decision as a no-op', () => {
    expect(reviewOutcome('pending', 'approve')).toBe('apply');
    expect(reviewOutcome('approved', 'approve')).toBe('repeat');
    expect(reviewOutcome('rejected', 'reject')).toBe('repeat');
    expect(reviewOutcome('approved', 'reject')).toBe('conflict');
    expect(reviewOutcome('rejected', 'approve')).toBe('conflict');
    expect(reviewOutcome('withdrawn', 'approve')).toBe('conflict');
  });
  it('bounds request fields and rejects unknown keys', () => {
    const ok = studioRequestCommand.parse({
      action: 'submit',
      name: '  North Studio ',
      contactPhone: '+91 90000 00000',
    });
    expect(ok).toMatchObject({ name: 'North Studio', note: '' });
    expect(() =>
      studioRequestCommand.parse({ action: 'submit', name: 'x', contactPhone: '+91 90000' }),
    ).toThrow();
    expect(() =>
      studioRequestCommand.parse({
        action: 'submit',
        name: 'North',
        contactPhone: '+91 90000 00000',
        ownerId: 'someone-else',
      }),
    ).toThrow();
    expect(() => studioRequestCommand.parse({ action: 'approve', requestId: '' })).toThrow();
  });
});

describe('ownership transfer and closure input', () => {
  it('requires the typed confirmation and a password', () => {
    expect(
      studioOwnershipCommand.safeParse({
        action: 'close',
        confirm: 'CLOSE',
        password: 'secret',
      }).success,
    ).toBe(true);
    expect(
      studioOwnershipCommand.safeParse({ action: 'close', confirm: 'close', password: 'x' })
        .success,
    ).toBe(false);
    expect(
      studioOwnershipCommand.safeParse({
        action: 'transfer',
        userId: 'u',
        confirm: 'TRANSFER',
        password: '',
      }).success,
    ).toBe(false);
  });
});

describe('closed studio placeholder owner', () => {
  it('can never receive mail or match a real account', () => {
    const owner = closedStudioOwner('studio-1');
    expect(owner.email.endsWith('.invalid')).toBe(true);
    expect(owner).toMatchObject({ emailVerified: false, role: 'system' });
    expect(owner.id).toBe('closed-studio-studio-1');
  });
  it('lets the owner of a closed studio be deleted but not of an open one', () => {
    expect(deletionBlocker({ ownsStudio: true })?.code).toBe('STUDIO_OWNER');
    expect(deletionBlocker({ ownsStudio: false })).toBeNull();
  });
});
