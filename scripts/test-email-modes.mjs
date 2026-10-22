import { grantLocalTestTerm } from './test-member-fixture.mjs';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';

const mode = process.argv[2];
assert.ok(['disabled', 'test'].includes(mode), 'Choose disabled or test email mode.');
// A unique disposable SQLite database; this test never uses provider credentials.
const databasePath = fileURLToPath(
  new URL(`../prisma/email-mode-${randomUUID()}.db`, import.meta.url),
);
const databaseUrl = `file:${databasePath.replaceAll('\\', '/')}`;
const origin = 'http://localhost:3001';
const env = {
  ...process.env,
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: randomBytes(48).toString('hex'),
  EMAIL_DELIVERY: mode,
  RESEND_API_KEY: '',
  EMAIL_FROM: '',
  LIVEKIT_URL: '',
  LIVEKIT_API_KEY: '',
  LIVEKIT_API_SECRET: '',
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  STRIPE_PRICE_ID: '',
  VERCEL: '1',
  NODE_ENV: 'production',
};
process.env.DATABASE_URL = databaseUrl;
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let server;
let exited;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};
async function stopServer() {
  if (server && server.exitCode === null) {
    server.kill();
    await Promise.race([exited, pause(5000)]);
  }
}
async function startServer(deliveryMode) {
  server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3001'],
    { env: { ...env, EMAIL_DELIVERY: deliveryMode }, windowsHide: true, stdio: 'ignore' },
  );
  exited = new Promise((resolve) => {
    server.once('exit', resolve);
    server.once('error', resolve);
  });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (server.exitCode !== null) break;
    try {
      const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (health.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the isolated server. */
    }
    await pause(300);
  }
  check(ready, 'The isolated auth server must start. Run npm run build first.');
}
const cookieFrom = (response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
async function request(path, body, cookie = '') {
  const response = await fetch(`${origin}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Origin: origin,
      Cookie: cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  return response;
}
async function command(body, account, status = 200) {
  const response = await request('/api/command', body, account.cookie);
  check(
    response.status === status,
    `Command ${body.action} must return ${status}, received ${response.status}.`,
  );
  return response.json();
}
try {
  const migration = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema=prisma/schema.prisma'],
    { env, windowsHide: true, encoding: 'utf8' },
  );
  assert.equal(migration.status, 0, 'The disposable SQLite migration must succeed.');
  const password = 'Disposable-Auth-Test-12345';
  await startServer(mode);
  const post = (path, body) => request(`/api/auth/${path}`, body);
  if (mode === 'test') {
    const signup = async (name, email) => {
      const response = await post('sign-up/email', {
        name,
        email,
        password,
        emailVerified: true,
        role: 'coach',
      });
      check(response.status === 200, 'Testing signup must be available without a sending domain.');
      const data = await response.json();
      const stored = await db.user.findUnique({ where: { id: data.user.id } });
      check(
        stored?.emailVerified === false && stored.role === 'unset',
        'Testing accounts must remain unverified and cannot choose a role through signup input.',
      );
      const cookie = cookieFrom(response);
      const session = await request('/api/auth/get-session', undefined, cookie).then((r) =>
        r.json(),
      );
      check(session?.user?.id === data.user.id, 'Signup must create a usable session.');
      return { id: data.user.id, email, cookie };
    };
    const coach = await signup('Testing Coach', 'coach@example.test');
    const trainee = await signup('Testing Trainee', 'trainee@example.test');
    await command(
      {
        action: 'onboard',
        name: 'Testing Coach',
        role: 'coach',
        studioName: 'Testing Studio',
        adult: true,
      },
      coach,
    );
    await command(
      { action: 'onboard', name: 'Testing Trainee', role: 'trainee', adult: true },
      trainee,
    );
    await command(
      { action: 'onboard', name: 'Changed role', role: 'coach', adult: true },
      trainee,
      409,
    );
    const invite = await command({ action: 'invite', email: trainee.email }, coach);
    await command({ action: 'acceptInvite', code: invite.code }, coach, 403);
    await command({ action: 'acceptInvite', code: invite.code }, trainee);
    await command({ action: 'acceptInvite', code: invite.code }, trainee, 400);
    const workspace = await request('/api/workspace', undefined, coach.cookie).then((r) =>
      r.json(),
    );
    check(
      workspace.clients.length === 1 && workspace.clients[0].id === trainee.id,
      'The coach must see the enrolled trainee.',
    );
    const acceptedMembership = await db.membership.findFirstOrThrow({
      where: { userId: trainee.id },
    });
    await grantLocalTestTerm(db, acceptedMembership.studioId, trainee.id);
    const session = await command(
      {
        action: 'createClass',
        title: 'Two-role testing',
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        duration: 30,
        capacity: 2,
        participantIds: [trainee.id],
      },
      coach,
    );
    await command({ action: 'classControl', id: session.id, control: 'start' }, trainee, 403);
    await command({ action: 'classControl', id: session.id, control: 'start' }, coach);
    await command(
      {
        action: 'message',
        id: session.id,
        text: 'Keep your movement controlled.',
        kind: 'cue',
        recipientId: trainee.id,
      },
      coach,
    );
    const traineeView = await request(`/api/classes/${session.id}`, undefined, trainee.cookie).then(
      (r) => r.json(),
    );
    check(
      traineeView.messages.some((message) => message.text === 'Keep your movement controlled.'),
      "The trainee must receive the coach's personal cue.",
    );
    await command({ action: 'classControl', id: session.id, control: 'end' }, coach);
    const login = await post('sign-in/email', { email: trainee.email, password });
    check(login.status === 200, 'An unverified testing account must be able to sign in again.');
    const reset = await post('request-password-reset', {
      email: trainee.email,
      redirectTo: `${origin}/login`,
    });
    check(
      reset.status === 400 && (await reset.json()).code === 'RESET_PASSWORD_DISABLED',
      'Testing mode must not offer unavailable email recovery.',
    );
    check(
      (await db.verification.count()) === 0,
      'Testing signup must not issue mail recovery tokens.',
    );
    const page = await fetch(`${origin}/login?mode=signup`).then((r) => r.text());
    check(
      page.includes('Testing mode: email verification is off.') &&
        page.includes('Create account') &&
        page.includes('Your name') &&
        !page.includes('Forgot password?'),
      'Testing signup and its limitations must be visible on the login page.',
    );
    await stopServer();
    await startServer('disabled');
    const existingSession = await request('/api/workspace', undefined, trainee.cookie);
    check(
      existingSession.status === 403,
      'Restoring verification must also gate existing unverified testing sessions.',
    );
    const gated = await post('sign-in/email', { email: trainee.email, password });
    check(
      gated.status === 403 && (await gated.json()).code === 'EMAIL_NOT_VERIFIED',
      'Restoring verification must gate testing account sign-in.',
    );
    console.log(
      `Two-role testing signup: ${checks} checks passed with an isolated SQLite database.`,
    );
  } else {
    const hashed = await hashPassword(password);
    for (const verified of [true, false]) {
      const id = randomUUID();
      await db.user.create({
        data: {
          id,
          email: `${verified ? 'verified' : 'unverified'}@example.test`,
          name: 'Disposable Test',
          emailVerified: verified,
          accounts: {
            create: { id: randomUUID(), accountId: id, providerId: 'credential', password: hashed },
          },
        },
      });
    }
    const signup = await post('sign-up/email', {
      email: 'new@example.test',
      name: 'New Test',
      password,
    });
    check(
      signup.status === 400 && (await signup.json()).code === 'EMAIL_PASSWORD_SIGN_UP_DISABLED',
      'Signup must be rejected at the API.',
    );
    check((await db.user.count()) === 2, 'A rejected signup must not create an account.');
    const reset = await post('request-password-reset', {
      email: 'verified@example.test',
      redirectTo: `${origin}/login`,
    });
    check(
      reset.status === 400 && (await reset.json()).code === 'RESET_PASSWORD_DISABLED',
      'Reset requests must be rejected before sending mail.',
    );
    check((await db.verification.count()) === 0, 'A rejected reset must not issue a token.');
    const unverified = await post('sign-in/email', { email: 'unverified@example.test', password });
    check(
      unverified.status === 403 && (await unverified.json()).code === 'EMAIL_NOT_VERIFIED',
      'Disabling email must not admit an unverified account.',
    );
    const verified = await post('sign-in/email', { email: 'verified@example.test', password });
    check(verified.status === 200, 'An existing verified account must still sign in.');
    const cookie = verified.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const session = await fetch(`${origin}/api/auth/get-session`, {
      headers: { Cookie: cookie },
    }).then((response) => response.json());
    check(
      session?.user?.email === 'verified@example.test',
      'Verified sign-in must produce a valid session.',
    );
    const page = await fetch(`${origin}/login`).then((response) => response.text());
    check(
      page.includes('New account registration and password reset are temporarily unavailable.') &&
        !page.includes('Create account') &&
        !page.includes('Forgot password?'),
      'The login page must explain unavailable actions and hide them.',
    );
    console.log(
      `Deferred-email authentication: ${checks} checks passed with an isolated SQLite database.`,
    );
  }
} finally {
  await stopServer();
  await db.$disconnect();
  for (const suffix of ['', '-journal', '-wal', '-shm'])
    await rm(databasePath + suffix, { force: true });
}
