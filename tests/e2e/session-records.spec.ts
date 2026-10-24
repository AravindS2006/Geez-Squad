import { provisionTestAdmin } from './support/admin';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import type { WorkoutSetRecord } from '../../src/lib/types';
process.loadEnvFile('.env');

test('shared session survives login, rescheduling reaches an open room, and ending freezes its timer', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const db = new PrismaClient();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: 'Asia/Kolkata',
    extraHTTPHeaders: { 'x-forwarded-for': `2001:db8:${randomBytes(2).toString('hex')}::1` },
  });
  const page = await context.newPage();
  const key = randomUUID(),
    email = `session-${key}@example.test`,
    password = randomBytes(24).toString('base64url');
  const headers = { Origin: 'http://localhost:3000' };
  let userId = '';
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const signup = await page.request.post('/api/auth/sign-up/email', {
      headers,
      data: { name: 'Session Coach', email, password },
    });
    expect(signup.ok()).toBe(true);
    userId = (await signup.json()).user.id;
    expect(
      (
        await page.request.post('/api/command', {
          headers,
          data: { action: 'onboard', name: 'Session Coach', role: 'trainee', adult: true },
        })
      ).ok(),
    ).toBe(true);
    await provisionTestAdmin(db, userId);
    const studio = await db.studio.findUniqueOrThrow({ where: { ownerId: userId } });
    const soon = await db.classSession.create({
      data: {
        studioId: studio.id,
        title: 'Nearest scheduled session',
        startsAt: new Date(Date.now() + 3600000),
        duration: 30,
      },
    });
    const live = await db.classSession.create({
      data: {
        studioId: studio.id,
        title: 'Join this live session first',
        status: 'live',
        startsAt: new Date(Date.now() - 86400000),
        startedAt: new Date(Date.now() - 120000),
      },
    });
    await db.classSession.createMany({
      data: Array.from({ length: 101 }, (_, index) => ({
        studioId: studio.id,
        title: `Later session ${index}`,
        startsAt: new Date(Date.now() + (index + 2) * 86400000),
      })),
    });
    await page.goto('/app?view=sessions');
    await expect(page.locator('.session-row').first()).toContainText(live.title);
    await expect(page.getByText(soon.title, { exact: true })).toBeVisible();
    await context.clearCookies();
    await page.goto(`/studio/${soon.id}`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/studio/${soon.id}$`));
    await expect(
      page.getByText('Start the class when you are ready.', { exact: false }),
    ).toBeVisible();
    const workspace = await (await page.request.get('/api/workspace')).json();
    const current = workspace.classes.find((entry: { id: string }) => entry.id === soon.id);
    const nextTime = new Date(Date.now() + 7200000).toISOString();
    expect(
      (
        await page.request.post('/api/command', {
          headers,
          data: {
            action: 'updateClass',
            id: soon.id,
            expectedVersion: current.editVersion,
            title: 'Rescheduled open room',
            startsAt: nextTime,
            duration: 60,
            capacity: 8,
            planId: null,
            participantIds: [],
          },
        })
      ).ok(),
    ).toBe(true);
    await expect(page.getByRole('heading', { name: 'Rescheduled open room' })).toBeVisible();
    await expect(page.locator('.meeting-schedule-bar')).toContainText('60 min planned');
    await expect(page.locator('.meeting-schedule-bar')).toContainText(/Asia\/(Kolkata|Calcutta)/);
    await page.getByRole('button', { name: 'Copy session link' }).click();
    await expect(page.getByRole('status')).toContainText(
      /Session link copied|Copy this session link/,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'docs/screenshots/session-waiting-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Start class', exact: true }).click();
    await expect(page.getByRole('button', { name: 'End session', exact: true })).toBeVisible();
    await db.classSession.update({
      where: { id: soon.id },
      data: { startedAt: new Date(Date.now() - 125000), paused: true },
    });
    await expect(page.getByLabel('Session elapsed time')).toContainText('02:');
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    await expect(page.getByRole('dialog').locator('.meeting-schedule-bar')).toContainText(
      'Meeting time includes pauses.',
    );
    expect((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations).toEqual(
      [],
    );
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    await page.getByRole('button', { name: 'End session for everyone' }).click();
    await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();
    const ended = await (await page.request.get(`/api/classes/${soon.id}`)).json();
    expect(ended.endedAt).toBeTruthy();
    expect(ended.participantCount).toBe(0);
    const elapsed = await page.getByLabel('Session elapsed time').textContent();
    // Observe several real timer ticks and a poll after the end transition.
    await page.waitForTimeout(3200);
    await expect(page.getByLabel('Session elapsed time')).toHaveText(elapsed!);
    await expect(page.locator('.meeting-status')).toHaveText('completed');
    await expect(page.getByRole('link', { name: 'View exercise records' })).toHaveAttribute(
      'href',
      '/app?view=analytics',
    );
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    if (userId) {
      await db.auditEvent.deleteMany({ where: { actorId: userId } });
      await db.user.deleteMany({ where: { id: userId } });
    }
    await db.$disconnect();
  }
});

test('schedule editor rejects DST gaps and preserves the second occurrence of a repeated hour', async ({
  browser,
}) => {
  test.setTimeout(60000);
  const db = new PrismaClient();
  const context = await browser.newContext({
    timezoneId: 'America/New_York',
    extraHTTPHeaders: { 'x-forwarded-for': `2001:db8:${randomBytes(2).toString('hex')}::1` },
  });
  const page = await context.newPage();
  const headers = { Origin: 'http://localhost:3000' };
  let userId = '';
  try {
    const signup = await page.request.post('/api/auth/sign-up/email', {
      headers,
      data: {
        name: 'Time Coach',
        email: `time-${randomUUID()}@example.test`,
        password: randomBytes(24).toString('base64url'),
      },
    });
    expect(signup.ok()).toBe(true);
    userId = (await signup.json()).user.id;
    expect(
      (
        await page.request.post('/api/command', {
          headers,
          data: { action: 'onboard', name: 'Time Coach', role: 'trainee', adult: true },
        })
      ).ok(),
    ).toBe(true);
    await provisionTestAdmin(db, userId);
    const studio = await db.studio.findUniqueOrThrow({ where: { ownerId: userId } });
    const original = '2027-11-07T06:30:45.000Z';
    const session = await db.classSession.create({
      data: { studioId: studio.id, title: 'Repeated clock hour', startsAt: new Date(original) },
    });
    await page.goto('/app?view=sessions');
    await page.getByRole('button', { name: 'Edit Repeated clock hour', exact: true }).click();
    await expect(page.getByLabel('Date & time')).toHaveValue('2027-11-07T01:30');
    await page.getByLabel('Session title').fill('Same instant after edit');
    await page.getByRole('button', { name: 'Save session changes' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(
      (
        await db.classSession.findUniqueOrThrow({ where: { id: session.id } })
      ).startsAt.toISOString(),
    ).toBe(original);
    await page.getByRole('button', { name: 'Schedule session', exact: true }).click();
    await page.getByLabel('Session title').fill('Invalid local time');
    await page.getByLabel('Date & time').fill('2027-03-14T02:30');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Schedule session', exact: true })
      .click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
      'Choose a valid local time',
    );
    expect(await db.classSession.count({ where: { studioId: studio.id } })).toBe(1);
  } finally {
    await context.close();
    if (userId) {
      await db.auditEvent.deleteMany({ where: { actorId: userId } });
      await db.user.deleteMany({ where: { id: userId } });
    }
    await db.$disconnect();
  }
});

test('exercise history recovers a pending save and exposes records beyond the first 50', async ({
  page,
}) => {
  test.setTimeout(60000);
  const db = new PrismaClient();
  const headers = { Origin: 'http://localhost:3000' };
  let userId = '';
  await page
    .context()
    .setExtraHTTPHeaders({ 'x-forwarded-for': `2001:db8:${randomBytes(2).toString('hex')}::1` });
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    const signup = await page.request.post('/api/auth/sign-up/email', {
      headers,
      data: {
        name: 'Record Trainee',
        email: `record-${randomUUID()}@example.test`,
        password: randomBytes(24).toString('base64url'),
      },
    });
    expect(signup.ok()).toBe(true);
    userId = (await signup.json()).user.id;
    expect(
      (
        await page.request.post('/api/command', {
          headers,
          data: { action: 'onboard', name: 'Record Trainee', role: 'trainee', adult: true },
        })
      ).ok(),
    ).toBe(true);
    const record: WorkoutSetRecord = {
      clientId: randomUUID(),
      classId: null,
      exercise: 'plank',
      revision: 0,
      ruleVersion: 'profile-v7',
      setNumber: 1,
      target: 30,
      reps: 0,
      holdMs: 0,
      activeMs: 5000,
      trackedMs: 5000,
      formScore: 60,
      qualityScore: null,
      rangeDegrees: null,
      repSeconds: null,
      confidence: 0.9,
      rejectedReps: 0,
      loadKg: null,
      completed: false,
      startedAt: new Date(Date.now() - 10000).toISOString(),
      endedAt: new Date(Date.now() - 5000).toISOString(),
    };
    await db.workoutSet.createMany({
      data: Array.from({ length: 51 }, () => ({
        ...record,
        clientId: randomUUID(),
        userId,
        startedAt: new Date(record.startedAt),
        endedAt: new Date(record.endedAt),
      })),
    });
    await page.goto('/app?view=analytics');
    await page.evaluate(
      ({ userId, record }) =>
        localStorage.setItem('geez-squad:pending-sets:v1', JSON.stringify([{ userId, record }])),
      { userId, record },
    );
    await page.reload();
    await expect(page.getByRole('button', { name: 'Retry pending saves' })).toBeVisible();
    await page.getByRole('button', { name: 'Retry pending saves' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Exercise records saved.' }),
    ).toBeVisible();
    expect(await db.workoutSet.count({ where: { userId } })).toBe(52);
    await expect(page.locator('.workout-record')).toHaveCount(50);
    await expect(page.locator('.workout-record').first()).toContainText('0s');
    await expect(page.locator('.workout-record').first()).toContainText('target 30s');
    await page.getByRole('button', { name: 'Load older exercise records' }).click();
    await expect(page.locator('.workout-record')).toHaveCount(52);
    await page.getByText('Exercise record details', { exact: true }).first().click();
    await expect(page.locator('.workout-record-details').first()).toContainText('Active 5s');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: 'docs/screenshots/exercise-records-mobile.png',
      fullPage: false,
    });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Retry pending saves' })).toHaveCount(0);
    expect(await db.workoutSet.count({ where: { userId } })).toBe(52);
  } finally {
    if (userId) {
      await db.auditEvent.deleteMany({ where: { actorId: userId } });
      await db.user.deleteMany({ where: { id: userId } });
    }
    await db.$disconnect();
  }
});
