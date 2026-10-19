import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
process.loadEnvFile('.env');

test('mobile studio journey persists membership, receipt, attendance, and booking', async ({
  page,
}) => {
  test.setTimeout(120000);
  const db = new PrismaClient(),
    email = `studio-ui-${randomUUID()}@example.test`,
    headers = { Origin: 'http://localhost:3000' };
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let userId = '';
  try {
    const signup = await page.request.post('/api/auth/sign-up/email', {
      headers,
      data: {
        name: 'Studio Browser Owner',
        email,
        password: randomBytes(24).toString('base64url'),
      },
    });
    expect(signup.ok()).toBe(true);
    userId = (await signup.json()).user.id;
    expect(
      (
        await page.request.post('/api/command', {
          headers,
          data: { action: 'onboard', role: 'coach', name: 'Studio Browser Owner', adult: true },
        })
      ).ok(),
    ).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app?view=members');
    await page.getByRole('button', { name: 'Add member', exact: true }).first().click();
    await page.getByLabel('Full name', { exact: true }).fill('Journey Member');
    await page.getByLabel('Email (optional)').fill(`journey-${randomUUID()}@example.test`);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'View Journey Member' })).toBeVisible();
    await page.goto('/app?view=memberships');
    await page.getByRole('button', { name: 'Create plan', exact: true }).first().click();
    await page.getByLabel('Plan name').fill('Journey Monthly');
    await page.getByLabel('Price (INR)').fill('2500.50');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Journey Monthly' })).toBeVisible();
    await page.getByRole('button', { name: 'Assign plan', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Member', exact: true })
      .selectOption({ label: 'Journey Member' });
    await page
      .getByRole('combobox', { name: 'Membership plan', exact: true })
      .selectOption({ label: 'Journey Monthly · ₹2,500.50 / 30 days' });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Assign membership', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto('/app?view=payments');
    await page.getByRole('button', { name: 'Record payment', exact: true }).click();
    await page.getByLabel('Membership to pay').selectOption({ index: 1 });
    await page.getByLabel('Amount received (INR)').fill('2500.50');
    await page.getByRole('button', { name: 'Confirm payment received' }).click();
    await page.getByRole('button', { name: 'Receipt', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('₹2,500.50', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.goto('/app?view=attendance');
    await page.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Check in', exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.getByText('1 checked in', { exact: true })).toBeVisible();
    await page.goto('/app?view=classes');
    await page.getByRole('button', { name: 'Schedule studio class', exact: true }).first().click();
    await page.getByLabel('Class name').fill('Journey Studio Class');
    await page.getByLabel('Trainer', { exact: true }).fill('Journey Coach');
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await page.getByLabel('Starts at (India time)').fill(`${tomorrow}T18:00`);
    await page.getByRole('button', { name: 'Save class', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Journey Studio Class' })).toBeVisible();
    await page.getByRole('button', { name: 'View roster' }).click();
    await page.getByRole('button', { name: 'Book place' }).click();
    await expect(page.getByRole('button', { name: 'Cancel booking' })).toBeVisible();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.reload();
    await expect(page.getByText('1 / 12 places booked')).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/studio-classes-mobile.png', fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    if (userId) {
      await db.auditEvent.deleteMany({ where: { actorId: userId } });
      await db.rateLimit.deleteMany({ where: { key: { contains: `:${userId}:` } } });
      await db.user.deleteMany({ where: { id: userId } });
    }
    await db.$disconnect();
  }
});

test('new studio pages meet automated accessibility checks', async ({ page }) => {
  test.setTimeout(120000);
  const issues: unknown[] = [];
  for (const path of [
    '/',
    '/demo',
    '/demo?view=members',
    '/demo?view=memberships',
    '/demo?view=attendance',
    '/demo?view=payments',
    '/demo?view=enquiries',
    '/demo?view=staff',
    '/demo?view=classes',
    '/demo?view=studio-details',
  ]) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    if (results.violations.length)
      issues.push({
        path,
        violations: results.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
        })),
      });
  }
  await page.goto('/demo');
  await page.screenshot({ path: 'docs/screenshots/studio-dashboard-desktop.png', fullPage: true });
  await page.goto('/');
  await page.screenshot({
    path: 'docs/screenshots/geez-squad-landing-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/screenshots/geez-squad-landing-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goto('/demo');
  await page.screenshot({ path: 'docs/screenshots/studio-dashboard-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(issues).toEqual([]);
});
