import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { provisionTestAdmin } from './support/admin';
process.loadEnvFile('.env');

test('existing sessions skip login, retain shared destinations, and expire back to sign-in', async ({
  page,
}) => {
  const db = new PrismaClient(),
    email = `returning-${randomUUID()}@example.test`;
  let userId = '';
  await page
    .context()
    .setExtraHTTPHeaders({ 'x-forwarded-for': `2001:db8:${randomBytes(2).toString('hex')}::1` });
  try {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    const signup = await page.request.post('/api/auth/sign-up/email', {
      headers: { Origin: 'http://localhost:3000' },
      data: { name: 'Returning member', email, password: randomBytes(24).toString('base64url') },
    });
    expect(signup.ok()).toBe(true);
    userId = (await signup.json()).user.id;
    await page.goto('/login');
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('heading', { name: 'How do you want to move?' })).toBeVisible();
    const response = await page.request.get('/login?next=%2Fstudio%2Fshared-test', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe('/studio/shared-test');
    const invitation = await page.request.get('/login?invite=legacy%26next%3Devil', {
      maxRedirects: 0,
    });
    expect(invitation.headers().location).toBe('/invite?code=legacy%26next%3Devil');
    const external = await page.request.get('/login?mode=signup&next=https%3A%2F%2Fexample.com', {
      maxRedirects: 0,
    });
    expect(external.headers().location).toBe('/app');
    await db.session.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    await page.context().addCookies([
      {
        name: 'better-auth.session_token',
        value: 'forged.session',
        url: 'http://localhost:3000',
      },
    ]);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  }
});

test('role menus group daily work, keep account controls visible, and expose mobile shortcuts', async ({
  browser,
}) => {
  const db = new PrismaClient(),
    key = randomUUID(),
    ids: string[] = [],
    contexts = [];
  try {
    for (const role of ['admin', 'coach', 'trainee']) {
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 720 },
        extraHTTPHeaders: { 'x-forwarded-for': `2001:db8:${randomBytes(2).toString('hex')}::1` },
      });
      contexts.push(ctx);
      const response = await ctx.request.post('http://localhost:3000/api/auth/sign-up/email', {
        headers: { Origin: 'http://localhost:3000' },
        data: {
          name: `Menu ${role}`,
          email: `menu-${role}-${key}@example.test`,
          password: randomBytes(24).toString('base64url'),
        },
      });
      expect(response.ok()).toBe(true);
      ids.push((await response.json()).user.id);
      expect(
        (
          await ctx.request.post('http://localhost:3000/api/command', {
            headers: { Origin: 'http://localhost:3000' },
            data: { action: 'onboard', role: 'trainee', adult: true, name: `Menu ${role}` },
          })
        ).ok(),
      ).toBe(true);
    }
    const studio = await provisionTestAdmin(db, ids[0]);
    await db.studioRoleGrant.createMany({
      data: [
        { studioId: studio.id, userId: ids[1], role: 'coach' },
        { studioId: studio.id, userId: ids[2], role: 'trainee' },
      ],
    });
    await db.membership.create({ data: { studioId: studio.id, userId: ids[2] } });
    const roles = ['admin', 'coach', 'trainee'];
    for (const [i, ctx] of contexts.entries()) {
      const page = await ctx.newPage();
      await page.goto('http://localhost:3000/app');
      const menu = page.getByRole('navigation', { name: 'Main menu', exact: true });
      const groupName = ['Daily studio', 'Daily coaching', 'Your studio'][i];
      await expect(menu.getByRole('group', { name: groupName, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Help & resources' })).toBeInViewport();
      if (i !== 0)
        await expect(menu.getByRole('link', { name: 'Payments', exact: true })).toHaveCount(0);
      if (i === 2)
        await expect(
          menu.getByRole('link', { name: 'My membership & classes', exact: true }),
        ).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      const quick = page.getByRole('navigation', { name: 'Quick access', exact: true });
      await expect(quick).toBeInViewport();
      await expect(quick.getByRole('link')).toHaveCount(4);
      await quick.getByRole('link').nth(1).click();
      await expect(quick.getByRole('link').nth(1)).toHaveAttribute('aria-current', 'page');
      await page.getByRole('button', { name: 'Open navigation' }).click();
      const drawer = page.getByRole('dialog', { name: 'Workspace navigation' });
      const brand = drawer.locator('.brand');
      await expect(brand).toBeVisible();
      await expect.poll(async () => Math.round((await drawer.boundingBox())!.x)).toBe(0);
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        const brandBounds = (await brand.boundingBox())!;
        const closeBounds = (await drawer
          .getByRole('button', { name: 'Close navigation' })
          .boundingBox())!;
        expect(brandBounds.x + brandBounds.width).toBeLessThanOrEqual(closeBounds.x);
        expect((await drawer.boundingBox())!.width).toBeLessThanOrEqual(width - 44);
      }
      await expect(drawer.getByRole('button', { name: 'Settings', exact: true })).toBeInViewport();
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
      await drawer.getByRole('link', { name: 'Camera practice', exact: true }).click();
      await expect(page).toHaveURL(/view=practice/);
      await expect(quick).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Studio requests', exact: true })).toHaveCount(
        0,
      );
      await page.getByRole('link', { name: 'Back to workspace', exact: true }).click();
      await expect(page).not.toHaveURL(/view=practice/);
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Workspace navigation' })).toHaveCount(0);
      await page.setViewportSize({ width: 844, height: 390 });
      const tabletBrand = (await page.locator('.sidebar .brand').boundingBox())!;
      const tabletSidebar = (await page.locator('.sidebar').boundingBox())!;
      expect(tabletBrand.x + tabletBrand.width).toBeLessThanOrEqual(
        tabletSidebar.x + tabletSidebar.width - 8,
      );
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeInViewport();
      await expect(menu.getByRole('link').last()).not.toBeInViewport();
      await menu.getByRole('link').last().scrollIntoViewIfNeeded();
      await expect(menu.getByRole('link').last()).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: `docs/screenshots/navigation-${roles[i]}-mobile.png`,
        fullPage: true,
      });
    }
  } finally {
    await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
    await Promise.all(contexts.map((c) => c.close()));
  }
});
