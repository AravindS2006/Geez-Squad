import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
process.loadEnvFile('.env');
test('returning member resumes the workspace and can manage a private nutrition journal', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const db = new PrismaClient(),
    email = `next-${randomUUID()}@example.test`;
  let context = await browser.newContext();
  try {
    const signup = await context.request.post('http://localhost:3000/api/auth/sign-up/email', {
      headers: {
        Origin: 'http://localhost:3000',
        'x-forwarded-for': `2001:db8:${randomBytes(2).toString('hex')}::1`,
      },
      data: { name: 'Returning Member', email, password: randomBytes(24).toString('base64url') },
    });
    expect(signup.ok()).toBe(true);
    await db.user.update({
      where: { email },
      data: { emailVerified: true, consentVersion: 'v1', role: 'trainee' },
    });
    const storageState = await context.storageState();
    await context.close();
    context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('http://localhost:3000/');
    await expect(page).toHaveURL(/\/app/);
    await page.goto('http://localhost:3000/login?mode=verify');
    await expect(page).toHaveURL(/\/app/);
    await page.getByRole('link', { name: 'Nutrition', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Small habits. A stronger you.' }),
    ).toBeVisible();
    await expect(page.getByLabel('Share my nutrition journal')).not.toBeChecked();
    await page.getByLabel('Food or drink', { exact: true }).fill('Oats and fruit');
    await page.getByLabel('Energy (kcal)', { exact: true }).fill('350');
    await page.getByLabel('Protein (g)', { exact: true }).fill('12.5');
    await page.getByRole('button', { name: 'Add entry', exact: true }).click();
    await expect(page.getByText('Nutrition journal saved.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('.nutrition-entry-list')).toContainText('Oats and fruit');
    await expect(page.locator('.nutrition-stats')).toContainText('350 kcal');
    await page.getByRole('button', { name: 'Edit Oats and fruit', exact: true }).click();
    await page.getByLabel('Energy (kcal)', { exact: true }).fill('400');
    await page.getByRole('button', { name: 'Update entry', exact: true }).click();
    await expect(page.locator('.nutrition-stats')).toContainText('400 kcal');
    await page.getByLabel('Daily protein (g)', { exact: true }).fill('100');
    await page.getByRole('button', { name: 'Save targets', exact: true }).click();
    await expect(page.locator('.nutrition-stats')).toContainText('Target 100 g');
    await page.getByLabel('Share my nutrition journal').check();
    await expect(page.getByLabel('Share my nutrition journal')).toBeChecked();
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      const overflow = await page.evaluate(() =>
        [...document.querySelectorAll('main *')].flatMap((e) => {
          const b = e.getBoundingClientRect();
          return b.width && b.right > innerWidth + 1
            ? [{ element: e.tagName, classes: e.className, right: b.right, width: b.width }]
            : [];
        }),
      );
      expect(overflow).toEqual([]);
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
    }
    await mkdir('docs/screenshots', { recursive: true });
    await page.screenshot({ path: 'docs/screenshots/nutrition-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Delete Oats and fruit', exact: true }).click();
    await expect(page.getByText('No entries for this day.', { exact: true })).toBeVisible();
    await page.goto('http://localhost:3000/app?view=practice');
    await page.getByRole('button', { name: 'Movement guide', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Movement guide' })).toBeVisible();
    await page.getByRole('button', { name: 'Close movement guide', exact: true }).click();
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.locator('.camera-view')).toBeVisible();
      const camera = await page.locator('.camera-view').boundingBox();
      expect(camera!.height).toBeGreaterThanOrEqual(400);
      const outside = await page.evaluate(() =>
        [...document.querySelectorAll('main *')].flatMap((e) => {
          const b = e.getBoundingClientRect();
          return b.width && b.right > innerWidth + 1
            ? [{ element: e.tagName, classes: e.className, right: b.right, width: b.width }]
            : [];
        }),
      );
      expect(outside).toEqual([]);
      await page.screenshot({
        path: `docs/screenshots/practice-${viewport.width}.png`,
        fullPage: true,
      });
    }
  } finally {
    await context.close();
    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      await db.auditEvent.deleteMany({ where: { actorId: user.id } });
      await db.user.delete({ where: { id: user.id } });
    }
    await db.$disconnect();
  }
});
test('sign-in session failure does not send an existing user to email verification', async ({
  page,
}) => {
  await page.route('**/api/auth/sign-in/email', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        redirect: false,
        token: 'fixture',
        url: null,
        user: { id: 'fixture', emailVerified: true },
      }),
    }),
  );
  await page.route('**/api/auth/get-session*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );
  await page.goto('/login');
  await page.getByLabel('Email address').fill('returning@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Local-only-fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.inline-error[role="alert"]')).toContainText(
    'Your session could not be established',
  );
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Resend verification email', exact: true }),
  ).toHaveCount(0);
});
test('PWA installs public assets, avoids private caches, and opens an offline fallback', async ({
  browser,
  request,
}) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({
    name: 'Geez Squad',
    display: 'standalone',
    start_url: '/app',
  });
  const worker = await request.get('/sw.js');
  expect(worker.headers()['cache-control']).toContain('no-store');
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    await page.goto('http://localhost:3000/login');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.request.get('/api/workspace');
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      return (
        await Promise.all(
          keys.map(async (key) =>
            (await (await caches.open(key)).keys()).map((r) => new URL(r.url).pathname),
          ),
        )
      ).flat();
    });
    expect(cached.sort()).toEqual(
      ['/offline.html', '/pwa/icon-192.png', '/pwa/icon-512.png'].sort(),
    );
    await context.setOffline(true);
    await page.goto('http://localhost:3000/app');
    await expect(page.getByRole('heading', { name: 'Your squad will be here.' })).toBeVisible();
    await context.setOffline(false);
    await page.getByRole('link', { name: 'Try connecting again' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  } finally {
    await context.close();
  }
});
