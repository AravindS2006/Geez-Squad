import { provisionTestAdmin } from './support/admin';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
process.loadEnvFile('.env');
test('personal email signup connects through Members and active membership controls participation', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const db = new PrismaClient(),
    key = randomUUID(),
    origin = 'http://localhost:3000';
  const coach = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': `2001:db8:${randomBytes(2).toString('hex')}::1` },
  });
  const client = await browser.newContext({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { 'x-forwarded-for': `2001:db8:${randomBytes(2).toString('hex')}::2` },
  });
  const ownerEmail = `link-owner-${key}@example.test`,
    email = `link-client-${key}@example.test`,
    ids: string[] = [];
  const headers = { Origin: origin };
  try {
    const owner = await coach.request.post('/api/auth/sign-up/email', {
      headers,
      data: {
        name: 'Link Owner',
        email: ownerEmail,
        password: randomBytes(24).toString('base64url'),
      },
    });
    expect(owner.ok()).toBe(true);
    ids.push((await owner.json()).user.id);
    expect(
      (
        await coach.request.post('/api/command', {
          headers,
          data: { action: 'onboard', role: 'trainee', name: 'Link Owner', adult: true },
        })
      ).ok(),
    ).toBe(true);
    await provisionTestAdmin(db, ownerEmail);
    const offer = await coach.request.post('/api/studio-operations', {
      headers,
      data: {
        action: 'offer',
        name: 'Studio Monthly',
        description: '',
        durationDays: 30,
        pricePaise: 250000,
        active: true,
      },
    });
    expect(offer.ok()).toBe(true);
    const offerId = (await offer.json()).id;
    const page = await client.newPage();
    await page.goto('/login?mode=signup');
    await page.getByLabel('Your name', { exact: true }).fill('Personal Email Client');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Local-Fixture-Password-12345');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('button', { name: /a coach/ })).toHaveCount(0);
    await page.getByRole('checkbox', { name: /I am 18/ }).check();
    await page.getByRole('button', { name: 'Create my workspace' }).click();
    await expect(
      page.getByRole('heading', { name: 'Your next chapter starts here.' }),
    ).toBeVisible();
    const account = await db.user.findUniqueOrThrow({ where: { email } });
    ids.push(account.id);
    // Local fixtures prove mailbox ownership explicitly; production must use the actual verification link.
    await db.user.update({ where: { id: account.id }, data: { emailVerified: true } });
    const ownerPage = await coach.newPage();
    await ownerPage.goto('/app?view=members');
    await ownerPage.getByRole('button', { name: 'Add member', exact: true }).first().click();
    await ownerPage.getByLabel('Full name', { exact: true }).fill('Personal Email Client');
    await ownerPage.getByLabel('Email (optional)').fill(email);
    await ownerPage.getByLabel('Membership plan (optional)').selectOption(offerId);
    await ownerPage.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(ownerPage.getByText('Pending confirmation', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Accept studio request', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your studio membership' })).toBeVisible();
    await expect(page.getByText(/Studio Monthly/).first()).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const member = await db.studioMember.findFirstOrThrow({ where: { userId: account.id } });
    const scheduled = await coach.request.post('/api/command', {
      headers,
      data: {
        action: 'createClass',
        title: 'Membership session',
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        duration: 30,
        capacity: 5,
        participantIds: [account.id],
      },
    });
    expect(scheduled.ok()).toBe(true);
    const sessionId = (await scheduled.json()).id;
    expect(
      (
        await coach.request.post('/api/command', {
          headers,
          data: { action: 'classControl', id: sessionId, control: 'start' },
        })
      ).ok(),
    ).toBe(true);
    expect((await client.request.get(`/api/classes/${sessionId}`)).ok()).toBe(true);
    const paused = await coach.request.post('/api/studio-operations', {
      headers,
      data: {
        action: 'member',
        id: member.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        goal: member.goal,
        joinedOn: member.joinedOn,
        status: 'paused',
      },
    });
    expect(paused.ok()).toBe(true);
    const state = await client.request.get(`/api/classes/${sessionId}`);
    expect((await state.json()).participationAllowed).toBe(false);
    expect(
      (
        await client.request.post('/api/video/token', { headers, data: { classId: sessionId } })
      ).status(),
    ).toBe(403);
    expect((await client.request.get('/api/my-membership')).ok()).toBe(true);
    expect((await client.request.get('/api/export')).ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your studio membership' })).toBeVisible();
    await mkdir('docs/screenshots', { recursive: true });
    await page.screenshot({ path: 'docs/screenshots/member-account-mobile.png', fullPage: true });
  } finally {
    await Promise.all([coach.close(), client.close()]);
    const created = await db.user.findMany({
      where: { email: { in: [ownerEmail, email] } },
      select: { id: true },
    });
    await db.auditEvent.deleteMany({ where: { actorId: { in: created.map((u) => u.id) } } });
    await db.user.deleteMany({ where: { id: { in: created.map((u) => u.id) } } });
    await db.$disconnect();
  }
});
test('redesigned authentication is accessible and fits phone and desktop', async ({ page }) => {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await mkdir('docs/screenshots', { recursive: true });
    await page.screenshot({ path: `docs/screenshots/auth-${width}.png`, fullPage: true });
  }
});
