import { provisionTestAdmin } from './support/admin';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';

process.loadEnvFile('.env');

const testAddress = () =>
  `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`;

test('the public home introduces the studio and keeps the workspace protected', async ({
  page,
}) => {
  const home = await page.request.get('/', { maxRedirects: 0 });
  expect(home.status()).toBe(200);

  const app = await page.request.get('/app', { maxRedirects: 0 });
  expect(app.status()).toBe(307);
  expect(new URL(app.headers().location, app.url()).pathname).toBe('/login');

  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Find your strength. Find your squad.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore the studio', exact: true })).toHaveAttribute(
    'href',
    '/demo',
  );
});

test('authenticated owners can enter the workspace and the demo remains separate', async ({
  page,
}) => {
  const email = `entry-coach-${randomUUID()}@example.test`;
  const address = testAddress();
  const db = new PrismaClient();
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': address });
  const headers = { Origin: 'http://localhost:3000' };
  try {
    const signup = await page.request.post('/api/auth/sign-up/email', {
      headers,
      data: { name: 'Entry Coach', email, password: 'Local-Integration-Only-12345' },
    });
    expect(signup.ok()).toBe(true);
    await provisionTestAdmin(db, email);
    const setup = await page.request.post('/api/command', {
      headers,
      data: { action: 'onboard', name: 'Entry Coach', role: 'trainee', adult: true },
    });
    expect(setup.ok()).toBe(true);

    await page.goto('/app');
    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByRole('heading', { name: 'A stronger studio starts here.' }),
    ).toBeVisible();

    await page.goto('/demo');
    await expect(page).toHaveURL(/\/demo$/);
    await expect(
      page.getByRole('heading', { name: 'A stronger studio starts here.' }),
    ).toBeVisible();
  } finally {
    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      await db.auditEvent.deleteMany({ where: { actorId: user.id } });
      await db.rateLimit.deleteMany({ where: { key: { contains: `:${user.id}:` } } });
      await db.user.delete({ where: { id: user.id } });
    }
    await db.rateLimit.deleteMany({ where: { key: { contains: address } } });
    await db.$disconnect();
  }
});
