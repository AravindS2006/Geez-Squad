import { provisionTestAdmin } from './support/admin';
import { grantStudioTerm } from './support/membership';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
process.loadEnvFile('.env');
// Simulate independent clients at the trusted local proxy boundary without disabling rate limits.
const testAddress = () =>
  `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`;
test('a real coach account can onboard and persist a workout plan', async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': testAddress() });
  const email = `browser-coach-${Date.now()}@example.test`;
  const db = new PrismaClient();
  try {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByLabel('Your name', { exact: true }).fill('Browser Coach');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Local-Integration-Only-12345');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'How do you want to move?' })).toBeVisible();
    await page.getByLabel('Your name', { exact: true }).fill('Browser Coach');
    await expect(page.getByRole('button', { name: /a coach/ })).toHaveCount(0);
    await page.getByRole('checkbox', { name: /I am 18/ }).check();
    await Promise.all([
      page.waitForEvent('framenavigated', (f) => f === page.mainFrame()),
      page.getByRole('button', { name: 'Create my workspace' }).click(),
    ]);
    await page.waitForLoadState('domcontentloaded');
    await expect(
      page.getByRole('heading', { name: 'Your next chapter starts here.' }),
    ).toBeVisible();
    await provisionTestAdmin(db, email);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'A stronger studio starts here.' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Workout plans' }).click();
    await page.getByRole('button', { name: 'Create plan', exact: true }).first().click();
    await page.getByLabel('Plan name').fill('Persisted foundations');
    await page
      .getByLabel('A little context')
      .fill('A real database record in the local test environment.');
    await page.getByRole('button', { name: 'Save workout plan' }).click();
    await expect(page.getByRole('heading', { name: 'Persisted foundations' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Persisted foundations' })).toBeVisible();
  } finally {
    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      await db.auditEvent.deleteMany({ where: { actorId: user.id } });
      await db.user.delete({ where: { id: user.id } });
    }
    await db.$disconnect();
  }
});

test('session controls wait for delayed client scripts before accepting a click', async ({
  page,
}) => {
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': testAddress() });
  const email = `hydration-coach-${Date.now()}@example.test`;
  const db = new PrismaClient();
  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  const headers = { Origin: 'http://localhost:3000' };
  try {
    const signup = await page.request.post('http://localhost:3000/api/auth/sign-up/email', {
      headers,
      data: { name: 'Loading Coach', email, password: 'Local-Integration-Only-12345' },
    });
    expect(signup.ok()).toBe(true);
    await provisionTestAdmin(db, email);
    const setup = await page.request.post('http://localhost:3000/api/command', {
      headers,
      data: { action: 'onboard', name: 'Loading Coach', role: 'trainee', adult: true },
    });
    expect(setup.ok()).toBe(true);
    const scheduled = await page.request.post('http://localhost:3000/api/command', {
      headers,
      data: {
        action: 'createClass',
        title: 'Loading rehearsal',
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        duration: 30,
        capacity: 2,
        participantIds: [],
      },
    });
    expect(scheduled.ok()).toBe(true);
    const session = await scheduled.json();
    // The direct room URL must work even when the workspace's latest 100
    // sessions no longer contain this authorized session.
    const studio = await db.studio.findFirstOrThrow({ where: { owner: { email } } });
    await db.classSession.createMany({
      data: Array.from({ length: 101 }, (_, index) => ({
        studioId: studio.id,
        title: `Later scheduled session ${index}`,
        startsAt: new Date(Date.now() + 86400000 + index * 60000),
      })),
    });
    await page.route('**/_next/static/**/*.js', async (route) => {
      await scriptsReady;
      await route.continue();
    });
    await page.goto(`/studio/${session.id}`, { waitUntil: 'commit' });
    await expect(page.locator('.live-studio')).toBeVisible();
    await expect(
      page
        .getByRole('button', { name: 'Start class', includeHidden: true })
        .click({ timeout: 500 }),
    ).rejects.toThrow(/Timeout/);
    const beforeReady = await page.request.get(`http://localhost:3000/api/classes/${session.id}`);
    expect((await beforeReady.json()).status).toBe('scheduled');
    releaseScripts();
    await page.getByRole('button', { name: 'Start class', exact: true }).click();
    await expect(page.getByRole('button', { name: 'End session', exact: true })).toBeVisible();
  } finally {
    releaseScripts();
    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      await db.auditEvent.deleteMany({ where: { actorId: user.id } });
      await db.user.delete({ where: { id: user.id } });
    }
    await db.$disconnect();
  }
});

test('a trainee follows an invitation through signup, onboarding, enrollment, and class completion', async ({
  browser,
}) => {
  test.setTimeout(60000);
  const suffix = Date.now();
  const coachEmail = `journey-coach-${suffix}@example.test`;
  const traineeEmail = `journey-trainee-${suffix}@example.test`;
  const db = new PrismaClient();
  const coachContext = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': testAddress() },
  });
  const traineeContext = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': testAddress() },
  });
  const coach = await coachContext.newPage();
  const trainee = await traineeContext.newPage();
  const headers = { Origin: 'http://localhost:3000' };
  try {
    const signup = await coachContext.request.post('http://localhost:3000/api/auth/sign-up/email', {
      headers,
      data: { name: 'Journey Coach', email: coachEmail, password: 'Local-Integration-Only-12345' },
    });
    expect(signup.ok()).toBe(true);
    await provisionTestAdmin(db, coachEmail);
    const setup = await coachContext.request.post('http://localhost:3000/api/command', {
      headers,
      data: {
        action: 'onboard',
        name: 'Journey Coach',
        role: 'trainee',
        studioName: 'Journey studio',
        adult: true,
      },
    });
    expect(setup.ok()).toBe(true);
    await coach.goto('http://localhost:3000/app?view=clients');
    const legacyInvite = await coachContext.request.post('http://localhost:3000/api/command', {
      headers,
      data: { action: 'invite', email: traineeEmail },
    });
    expect(legacyInvite.ok()).toBe(true);
    const inviteUrl = (await legacyInvite.json()).url;
    await trainee.goto(inviteUrl);
    await trainee.getByRole('button', { name: 'Create account', exact: true }).click();
    await trainee.getByLabel('Your name', { exact: true }).fill('Journey Trainee');
    await trainee.getByLabel('Email address').fill(traineeEmail);
    await trainee.getByLabel('Password', { exact: true }).fill('Local-Integration-Only-12345');
    await trainee.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(trainee.getByRole('heading', { name: 'How do you want to move?' })).toBeVisible();
    await expect(trainee.getByRole('button', { name: /a coach/ })).toHaveCount(0);
    const setupAccessibility = await new AxeBuilder({ page: trainee })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      setupAccessibility.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
    ).toEqual([]);
    await trainee.getByLabel('Your name', { exact: true }).fill('Journey Trainee');
    await trainee.getByRole('checkbox', { name: /I am 18/ }).check();
    await trainee.getByRole('button', { name: 'Create my workspace' }).click();
    await trainee.getByRole('button', { name: 'Join studio' }).click();
    await expect(
      trainee.getByRole('heading', { name: 'Your next chapter starts here.' }),
    ).toBeVisible();
    await coach.reload();
    await expect(coach.getByRole('heading', { name: 'Journey Trainee' })).toBeVisible();
    await grantStudioTerm(db, traineeEmail);
    await coach.getByRole('link', { name: 'Live sessions', exact: true }).click();
    await coach.getByRole('button', { name: 'Schedule session', exact: true }).click();
    await coach.getByLabel('Session title').fill('A shared journey');
    await coach.getByRole('checkbox', { name: /Journey Trainee/ }).check();
    await coach
      .getByRole('dialog')
      .getByRole('button', { name: 'Schedule session', exact: true })
      .click();
    await coach.getByRole('button', { name: /^(Open studio|Join session)$/ }).click();
    const startResponsePromise = coach.waitForResponse(
      (response) => {
        if (!response.url().endsWith('/api/command') || response.request().method() !== 'POST')
          return false;
        const command = response.request().postDataJSON();
        return command?.action === 'classControl' && command.control === 'start';
      },
      { timeout: 15000 },
    );
    await coach.getByRole('button', { name: 'Start class', exact: true }).click();
    const startResponse = await startResponsePromise;
    expect(startResponse.status(), JSON.stringify(await startResponse.json())).toBe(200);
    await expect(coach.getByRole('button', { name: 'End session', exact: true })).toBeVisible();
    await trainee.getByRole('link', { name: 'Live sessions', exact: true }).click();
    await expect(trainee.getByText('A shared journey', { exact: true })).toBeVisible();
    await trainee.getByRole('button', { name: /^(Open studio|Join session)$/ }).click();
    await expect(
      trainee.getByRole('button', { name: /Enable camera|Turn on session camera/ }),
    ).toBeVisible();
    const videoButton = trainee.getByRole('button', {
      name: /^(Join live video|Live video unavailable)$/,
    });
    await expect(videoButton).toBeVisible();
    const workspace = await coachContext.request.get('http://localhost:3000/api/workspace');
    expect(workspace.ok()).toBe(true);
    if ((await workspace.json()).services.video) {
      await videoButton.click();
      const consentDialog = trainee.getByRole('dialog');
      await expect(consentDialog.getByRole('button', { name: 'Join live video' })).toBeDisabled();
      await consentDialog.getByRole('button', { name: 'Close dialog' }).click();
    } else await expect(videoButton).toBeDisabled();
    await trainee.getByRole('button', { name: 'Ask my coach for help' }).click();
    await expect(coach.getByText('Help requested', { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await coach.getByRole('button', { name: /Journey Trainee/ }).click();
    await coach.getByRole('button', { name: 'Coach tools', exact: true }).click();
    await coach
      .getByRole('dialog')
      .getByLabel('Coaching cue', { exact: true })
      .fill('Let’s keep the movement controlled.');
    await coach.getByRole('button', { name: 'Send personal cue' }).click();
    await coach.getByRole('button', { name: 'Close dialog' }).click();
    await expect(trainee.locator('.human-cue')).toContainText(
      'Let’s keep the movement controlled.',
    );
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await trainee.setViewportSize(viewport);
      for (const selector of ['.meeting-analyzer', '.coach-stage', '.meeting-dock']) {
        const box = await trainee.locator(selector).boundingBox();
        expect(
          box,
          `${selector} is rendered at ${viewport.width}×${viewport.height}`,
        ).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(-1);
        expect(box!.y).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
      }
      expect(
        await trainee.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    const accessibility = await new AxeBuilder({ page: trainee })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      accessibility.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
    ).toEqual([]);
    await coach.getByRole('button', { name: 'End session', exact: true }).click();
    await coach.getByRole('button', { name: 'End session for everyone' }).click();
    await expect(trainee.getByRole('heading', { name: 'Session complete' })).toBeVisible({
      timeout: 10000,
    });
  } finally {
    for (const context of [coachContext, traineeContext]) {
      try {
        await context.close();
      } catch {
        // A timed-out test may already have closed its contexts. Preserve the original failure.
      }
    }
    const users = await db.user.findMany({
      where: { email: { in: [coachEmail, traineeEmail] } },
      select: { id: true },
    });
    await db.auditEvent.deleteMany({ where: { actorId: { in: users.map((u) => u.id) } } });
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await db.$disconnect();
  }
});
