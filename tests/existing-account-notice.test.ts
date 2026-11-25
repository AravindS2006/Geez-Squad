import { expect, it } from 'vitest';
import { notifyExistingAccountSignUp } from '../src/lib/existing-account-notice';
import type { RenderedEmail } from '../src/lib/email-templates';
import {
  claimVerificationEmail,
  EXISTING_ACCOUNT_EMAIL_WINDOW_MS,
} from '../src/lib/verification-throttle';

// Behaves like the RateLimit table: unique key on insert, single-row conditional update.
function fakeStore() {
  const rows = new Map<string, { count: number; lastRequest: bigint }>();
  return {
    async create({ data }: { data: { key: string; count: number; lastRequest: bigint } }) {
      if (rows.has(data.key))
        throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      rows.set(data.key, { count: data.count, lastRequest: data.lastRequest });
    },
    async updateMany({
      where,
      data,
    }: {
      where: { key: string; lastRequest: { lt: bigint } | bigint };
      data: { count?: { increment: number }; lastRequest: bigint };
    }) {
      const row = rows.get(where.key);
      const match =
        row &&
        (typeof where.lastRequest === 'bigint'
          ? row.lastRequest === where.lastRequest
          : row.lastRequest < where.lastRequest.lt);
      if (!row || !match) return { count: 0 };
      row.lastRequest = data.lastRequest;
      if (data.count) row.count += data.count.increment;
      return { count: 1 };
    },
  };
}

const user = { id: 'user-1', email: 'riya@example.test', name: 'Riya Sharma' };
const loginUrl = 'https://app.example.test/login';
const t0 = 1_000_000;

function outbox() {
  const sent: { to: string; mail: RenderedEmail }[] = [];
  return { sent, send: async (to: string, mail: RenderedEmail) => void sent.push({ to, mail }) };
}

it('emails the account owner a sign-in link', async () => {
  const box = outbox();
  const result = await notifyExistingAccountSignUp({
    store: fakeStore(),
    user,
    loginUrl,
    send: box.send,
    now: t0,
  });
  expect(result).toBe('sent');
  expect(box.sent).toHaveLength(1);
  expect(box.sent[0].to).toBe('riya@example.test');
  expect(box.sent[0].mail.subject).toBe('You already have a Geez Squad account');
  expect(box.sent[0].mail.text).toContain(`Sign in to Geez Squad: ${loginUrl}`);
  expect(box.sent[0].mail.text).toContain('Forgot password');
});

it('sends at most one email per user in 15 minutes', async () => {
  const store = fakeStore();
  const box = outbox();
  const notify = (now: number) =>
    notifyExistingAccountSignUp({ store, user, loginUrl, send: box.send, now });
  expect(EXISTING_ACCOUNT_EMAIL_WINDOW_MS).toBe(15 * 60_000);
  expect(await notify(t0)).toBe('sent');
  expect(await notify(t0 + 60_000)).toBe('throttled');
  expect(await notify(t0 + EXISTING_ACCOUNT_EMAIL_WINDOW_MS - 1)).toBe('throttled');
  expect(box.sent).toHaveLength(1);
  expect(await notify(t0 + EXISTING_ACCOUNT_EMAIL_WINDOW_MS + 1)).toBe('sent');
  expect(box.sent).toHaveLength(2);
});

it('lets only one of several simultaneous sign-up attempts send', async () => {
  const store = fakeStore();
  const box = outbox();
  await Promise.all(
    [0, 1, 2, 3].map(() =>
      notifyExistingAccountSignUp({ store, user, loginUrl, send: box.send, now: t0 }),
    ),
  );
  expect(box.sent).toHaveLength(1);
});

it('does not share a window with verification emails', async () => {
  const store = fakeStore();
  const box = outbox();
  expect(await claimVerificationEmail(store, user.id, t0)).toBe(true);
  expect(
    await notifyExistingAccountSignUp({ store, user, loginUrl, send: box.send, now: t0 }),
  ).toBe('sent');
  expect(await claimVerificationEmail(store, user.id, t0 + 1_000)).toBe(false);
});

it('never throws when delivery fails, and frees the window for a retry', async () => {
  const store = fakeStore();
  const failing = async () => {
    throw new Error('Email could not be delivered. Please retry shortly.');
  };
  expect(await notifyExistingAccountSignUp({ store, user, loginUrl, send: failing, now: t0 })).toBe(
    'failed',
  );
  const box = outbox();
  expect(
    await notifyExistingAccountSignUp({ store, user, loginUrl, send: box.send, now: t0 + 1_000 }),
  ).toBe('sent');
});

it('never throws when the rate-limit store is down', async () => {
  const store = fakeStore();
  store.create = async () => {
    throw new Error('database offline');
  };
  const box = outbox();
  expect(
    await notifyExistingAccountSignUp({ store, user, loginUrl, send: box.send, now: t0 }),
  ).toBe('failed');
  expect(box.sent).toHaveLength(0);
});
