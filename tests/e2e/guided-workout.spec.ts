import { grantStudioTerm } from './support/membership';
import { chromium, expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  addPoseFixture,
  changePose,
  moveThroughAngles,
  type PoseFixture,
} from './support/pose-fixture';

process.loadEnvFile('.env');

test('pausing cancels calibration and pending movement while retaining completed repetitions', async () => {
  test.setTimeout(60000);
  const browser = await chromium.launch({
    channel: 'msedge',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const address = () =>
    `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`;
  const coachAddress = address();
  const traineeAddress = address();
  const coach = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': coachAddress },
  });
  const trainee = await browser.newContext({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { 'x-forwarded-for': traineeAddress },
  });
  const page = await trainee.newPage();
  const db = new PrismaClient();
  const fixtureId = randomUUID();
  const coachEmail = `pause-coach-${fixtureId}@example.test`;
  const traineeEmail = `pause-trainee-${fixtureId}@example.test`;
  const origin = 'http://localhost:3000';
  const headers = { Origin: origin };
  try {
    for (const [request, name, email, role] of [
      [coach.request, 'Pause Coach', coachEmail, 'coach'],
      [trainee.request, 'Pause Trainee', traineeEmail, 'trainee'],
    ] as const) {
      const signup = await request.post(`${origin}/api/auth/sign-up/email`, {
        headers,
        data: { name, email, password: 'Local-Integration-Only-12345' },
      });
      expect(signup.ok()).toBe(true);
      const setup = await request.post(`${origin}/api/command`, {
        headers,
        data: { action: 'onboard', name, role, adult: true },
      });
      expect(setup.ok()).toBe(true);
    }
    const invite = await coach.request.post(`${origin}/api/command`, {
      headers,
      data: { action: 'invite', email: traineeEmail },
    });
    expect(invite.ok()).toBe(true);
    const accepted = await trainee.request.post(`${origin}/api/command`, {
      headers,
      data: { action: 'acceptInvite', code: (await invite.json()).code },
    });
    expect(accepted.ok()).toBe(true);
    const traineeUser = await db.user.findUniqueOrThrow({ where: { email: traineeEmail } });
    await grantStudioTerm(db, traineeEmail);
    const created = await coach.request.post(`${origin}/api/command`, {
      headers,
      data: {
        action: 'createClass',
        title: 'Safe pause and calibration',
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        duration: 30,
        capacity: 2,
        participantIds: [traineeUser.id],
      },
    });
    expect(created.ok()).toBe(true);
    const session = await created.json();
    async function control(value: 'start' | 'pause' | 'resume') {
      const result = await coach.request.post(`${origin}/api/command`, {
        headers,
        data: { action: 'classControl', id: session.id, control: value },
      });
      expect(result.ok()).toBe(true);
    }
    await control('start');
    await addPoseFixture(page);
    await page.goto(`/studio/${session.id}`);
    await changePose(page, { poseAngle: 170 });
    await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
    await expect(page.getByText('Pose detected', { exact: true })).toBeVisible();
    const analyzer = page.locator('.camera-analyzer');
    await analyzer.evaluate((node, id) => node.setAttribute('data-pause-fixture', id), fixtureId);
    const reps = page.getByTestId('cumulative-reps');
    const settings = page.getByRole('button', { name: 'Workout settings', exact: true });
    const start = page.getByRole('button', { name: 'Start set', exact: true });
    const cancelCalibration = page.getByRole('button', { name: 'Cancel calibration', exact: true });

    await settings.click();
    await page.getByLabel('Reps per set').fill('3');
    await page.getByRole('button', { name: 'Calibrate movement with your coach' }).click();
    await expect(cancelCalibration).toBeVisible();
    await expect(page.locator('.analyzer-cue')).toContainText('comfortable end position');
    await control('pause');
    // Exercise and revision remain unchanged. This exercises the pause lifecycle,
    // rather than passing because a different exercise remounts the analyzer.
    await expect(cancelCalibration).toHaveCount(0);
    await expect(start).toBeDisabled();
    await expect(reps).toHaveText('00');
    await expect(analyzer).toHaveAttribute('data-pause-fixture', fixtureId);
    expect(await page.evaluate(() => (window as unknown as PoseFixture).drawnPoseJoints)).toBe(0);
    await control('resume');
    await expect(start).toBeEnabled();
    await expect(cancelCalibration).toHaveCount(0);
    await settings.click();
    await page.getByText('Adjust tracking with your coach', { exact: true }).click();
    await expect(page.getByLabel('Higher endpoint (°)')).toHaveValue('155');
    await expect(page.getByLabel('Lower endpoint (°)')).toHaveValue('112');
    await page.getByRole('button', { name: 'Close dialog' }).click();

    await changePose(page, { poseAngle: 180 });
    await start.click();
    const pause = page.getByRole('button', { name: 'Pause set', exact: true });
    const resume = page.getByRole('button', { name: 'Resume set', exact: true });
    await expect(pause).toBeVisible();
    async function lower() {
      await moveThroughAngles(page, [165, 145, 125, 105, 95]);
      await expect(page.locator('.phase-text')).toHaveText('lowered');
      await page.waitForTimeout(650);
    }
    async function extend() {
      await moveThroughAngles(page, [105, 125, 145, 165, 180]);
    }
    await lower();
    await extend();
    await expect(reps).toHaveText('01');
    await lower();
    await pause.click();
    await expect(resume).toBeVisible();
    await expect(reps).toHaveText('01');
    expect(await page.evaluate(() => (window as unknown as PoseFixture).drawnPoseJoints)).toBe(0);
    await resume.click();
    await expect(pause).toBeVisible();
    await expect(page.locator('.phase-text')).toHaveText('find start position');
    // Returning from the pre-pause bottom cannot complete the discarded rep.
    await extend();
    await expect(page.locator('.phase-text')).toHaveText('start position');
    await expect(reps).toHaveText('01');
    await lower();
    await extend();
    await expect(reps).toHaveText('02');
    await expect(analyzer).toHaveAttribute('data-pause-fixture', fixtureId);
    expect(await page.evaluate(() => (window as unknown as PoseFixture).terminatedWorkers)).toBe(0);
  } finally {
    try {
      const users = await db.user.findMany({
        where: { email: { in: [coachEmail, traineeEmail] } },
        select: { id: true },
      });
      const ids = users.map((user) => user.id);
      await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
      await db.rateLimit.deleteMany({
        where: {
          OR: [
            ...ids.map((id) => ({ key: { contains: `:${id}:` } })),
            { key: { contains: coachAddress } },
            { key: { contains: traineeAddress } },
          ],
        },
      });
      await db.user.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await db.$disconnect();
      await browser.close();
    }
  }
});

test('guided calibration saves a personal range on mobile without starting or counting a set', async () => {
  test.setTimeout(30000);
  const browser = await chromium.launch({
    channel: 'msedge',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await addPoseFixture(page);
  try {
    await page.goto('/demo?view=practice');
    await changePose(page, { poseAngle: 170 });
    await page.getByRole('button', { name: 'Enable camera' }).click();
    await expect(page.getByText('Pose detected', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
    await page.getByRole('button', { name: 'Calibrate movement with your coach' }).click();
    await expect(page.getByRole('button', { name: 'Start set', exact: true })).toBeDisabled();
    await expect(page.locator('.analyzer-cue')).toContainText('comfortable end position', {
      timeout: 10000,
    });
    await moveThroughAngles(page, [160, 150, 140, 130, 120, 110, 100, 90]);
    await expect(page.locator('.analyzer-cue')).toContainText('Your measured range is saved', {
      timeout: 10000,
    });
    await expect(page.getByTestId('cumulative-reps')).toHaveText('00');
    await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
    await page.getByText('Adjust tracking with your coach', { exact: true }).click();
    await expect(page.getByLabel('Higher endpoint (°)')).toHaveValue('166');
    await expect(page.getByLabel('Lower endpoint (°)')).toHaveValue('94');
    await expect(page.getByLabel('Body side')).toHaveValue('left');
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('geez-squad-workout-v3-squat')!).calibrationSource,
      ),
    ).toBe('2d');
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
    await page.getByText('Adjust tracking with your coach', { exact: true }).click();
    await expect(page.getByLabel('Higher endpoint (°)')).toHaveValue('166');
  } finally {
    await browser.close();
  }
});

test('guided sets count only after the hands-free countdown, recover between sets, and retain cumulative reps', async () => {
  test.setTimeout(60000);
  const browser = await chromium.launch({
    channel: 'msedge',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await addPoseFixture(page);
  try {
    await page.goto('http://localhost:3000/demo?view=practice');
    await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
    await page.getByLabel('Sets', { exact: true }).fill('2');
    await page.getByLabel('Reps per set').fill('1');
    await page.getByLabel('Rest (seconds)').fill('1');
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Enable camera' }).click();
    await expect(page.getByText('Pose detected', { exact: true })).toBeVisible();
    const reps = page.getByTestId('cumulative-reps');
    await expect(reps).toHaveText('00');
    await expect(page.getByRole('button', { name: 'Start set', exact: true })).toBeEnabled();
    // Positioning and rehearsing before Start must never increase the workout total.
    await changePose(page, { poseAngle: 95 });
    await page.waitForTimeout(750);
    await changePose(page, { poseAngle: 180 });
    await page.waitForTimeout(500);
    await expect(reps).toHaveText('00');
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations).toEqual([]);
    for (let set = 1; set <= 2; set++) {
      await page
        .getByRole('button', { name: set === 1 ? 'Start set' : 'Start next set', exact: true })
        .click();
      await expect(page.getByRole('button', { name: 'Cancel start', exact: true })).toBeVisible();
      await expect(page.getByLabel('Set start countdown')).toContainText('5');
      await expect(reps).toHaveText(String(set - 1).padStart(2, '0'));
      if (set === 1) {
        await page.screenshot({ path: 'docs/screenshots/handsfree-countdown-mobile.png' });
        const countdownAxe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(countdownAxe.violations).toEqual([]);
      }
      await expect(page.getByRole('button', { name: 'Pause set', exact: true })).toBeVisible();
      await expect(page.locator('.phase-text')).toHaveText('start position');
      await moveThroughAngles(page, [165, 145, 125, 105, 95]);
      await expect(page.locator('.phase-text')).toHaveText('lowered');
      await page.waitForTimeout(650);
      await moveThroughAngles(page, [105, 125, 145, 165, 180]);
      await expect(reps).toHaveText(String(set).padStart(2, '0'));
      await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
      await expect(page.locator('.set-results tbody tr')).toHaveCount(set);
      await page.getByRole('button', { name: 'Close dialog' }).click();
    }
    await expect(page.getByText('Workout complete', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Stop local camera analysis' }).click();
    await expect(page.getByRole('button', { name: 'Enable camera' })).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as { terminatedWorkers: number }).terminatedWorkers,
      ),
    ).toBeGreaterThan(0);
  } finally {
    await browser.close();
  }
});

test('hands-free start waits for a stable starting pose and cancels safely', async () => {
  test.setTimeout(60000);
  const browser = await chromium.launch({
    channel: 'msedge',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await addPoseFixture(page);
  try {
    await page.goto('http://localhost:3000/demo?view=practice');
    await changePose(page, { poseVisible: false });
    await page.getByRole('button', { name: 'Enable camera' }).click();
    await expect(page.getByText('Position camera', { exact: true })).toBeVisible();
    const reps = page.getByTestId('cumulative-reps');
    const start = page.getByRole('button', { name: 'Start set', exact: true });
    const cancel = page.getByRole('button', { name: 'Cancel start', exact: true });
    const active = page.getByRole('button', { name: 'Pause set', exact: true });
    // A trainee can arm at the phone before moving back into the camera's view.
    await expect(start).toBeEnabled();
    await start.click();
    await expect(cancel).toBeVisible();
    await expect(active).toHaveCount(0);
    await changePose(page, { poseVisible: true });
    const countdown = page.getByLabel('Set start countdown');
    await expect(countdown).toContainText('5');
    await expect(countdown).toContainText('3');
    await expect(reps).toHaveText('00');
    // Leaving frame resets the full countdown; elapsed wall time cannot start a set.
    await changePose(page, { poseVisible: false });
    await expect(page.getByText('Position camera', { exact: true })).toBeVisible();
    await page.waitForTimeout(3500);
    await expect(cancel).toBeVisible();
    await expect(active).toHaveCount(0);
    await expect(reps).toHaveText('00');
    // A visible but lowered squat is not a valid starting position.
    await changePose(page, { poseVisible: true, poseAngle: 95 });
    await expect(page.getByText('Pose detected', { exact: true })).toBeVisible();
    await page.waitForTimeout(5500);
    await expect(cancel).toBeVisible();
    await expect(active).toHaveCount(0);
    await expect(reps).toHaveText('00');
    await changePose(page, { poseAngle: 180 });
    await expect(countdown).toContainText('5');
    await expect(countdown).toContainText('3');
    await cancel.click();
    await expect(start).toBeEnabled();
    await page.waitForTimeout(3500);
    await expect(active).toHaveCount(0);
    await expect(reps).toHaveText('00');
    // Backgrounding a mobile browser cancels the pending start, rather than
    // starting a workout when the user later returns to the tab.
    await start.click();
    await expect(cancel).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(cancel).toHaveCount(0);
    await expect(active).toHaveCount(0);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(start).toBeEnabled();
    // Changing the selected movement invalidates any pending start, even when
    // the camera stays connected and keeps producing landmarks.
    await start.click();
    await expect(cancel).toBeVisible();
    await page.getByLabel('Exercise to practice').selectOption('plank');
    await expect(cancel).toHaveCount(0);
    await expect(active).toHaveCount(0);
    await expect(reps).toHaveText('0s');
    await page.getByLabel('Exercise to practice').selectOption('squat');
    await expect(start).toBeEnabled();
    await expect(reps).toHaveText('00');
    // Stopping and restarting the camera must not preserve an armed start.
    await start.click();
    await expect(cancel).toBeVisible();
    await expect(countdown).toContainText('3');
    // A stalled worker / frozen camera cannot finish the remaining countdown.
    await changePose(page, { poseFramesEnabled: false });
    await page.waitForTimeout(5500);
    await expect(cancel).toBeVisible();
    await expect(active).toHaveCount(0);
    // Stale landmarks must disappear instead of presenting old posture as live.
    expect(
      await page.locator('.pose-canvas').evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const pixels = canvas
          .getContext('2d')!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        return pixels.every((value, index) => index % 4 !== 3 || value === 0);
      }),
    ).toBe(true);
    await changePose(page, { poseFramesEnabled: true });
    await page.getByRole('button', { name: 'Retry tracking', exact: true }).click();
    await expect(start).toBeEnabled();
    await expect(cancel).toHaveCount(0);
    await start.click();
    await expect(cancel).toBeVisible();
    await page.getByRole('button', { name: 'Stop local camera analysis' }).click();
    await expect(page.getByRole('button', { name: 'Enable camera' })).toBeVisible();
    await changePose(page, { poseFramesEnabled: true });
    await page.getByRole('button', { name: 'Enable camera' }).click();
    await expect(start).toBeEnabled();
    await expect(cancel).toHaveCount(0);
    await page.waitForTimeout(5500);
    await expect(active).toHaveCount(0);
    await start.click();
    await expect(active).toBeVisible();
    await expect(reps).toHaveText('00');
    expect(
      await page.evaluate(() => (window as unknown as PoseFixture).terminatedWorkers),
    ).toBeGreaterThan(0);
  } finally {
    await browser.close();
  }
});

test('countdown tolerates small posture changes and pauses for a brief tracking dropout', async () => {
  const browser = await chromium.launch({
    channel: 'msedge',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await addPoseFixture(page);
  try {
    await page.goto('http://localhost:3000/demo?view=practice');
    await changePose(page, { poseAngle: 150 });
    await page.getByRole('button', { name: 'Enable camera' }).click();
    const start = page.getByRole('button', { name: 'Start set', exact: true });
    const active = page.getByRole('button', { name: 'Pause set', exact: true });
    const countdown = page.getByLabel('Set start countdown');
    const remaining = countdown.locator('strong');
    const reps = page.getByTestId('cumulative-reps');
    await expect(start).toBeEnabled();
    await start.click();
    // The more forgiving continuation threshold must not weaken initial setup.
    await page.waitForTimeout(1400);
    await expect(countdown).toHaveCount(0);
    await expect(active).toHaveCount(0);
    await changePose(page, { poseAngle: 180 });
    await expect(remaining).toHaveText('5');
    await expect(remaining).toHaveText('3');
    // Five degrees below the configured top angle is ordinary stance movement,
    // not a new exercise or a reason to start another five-second countdown.
    await changePose(page, { poseAngle: 150 });
    await expect(remaining).toHaveText('2');
    await expect(reps).toHaveText('00');
    await changePose(page, { poseVisible: false });
    await expect(page.getByText('Position camera', { exact: true })).toBeVisible();
    await expect(countdown).toContainText('Countdown paused');
    await page.waitForTimeout(500);
    await expect(remaining).toHaveText('2');
    await expect(active).toHaveCount(0);
    await changePose(page, { poseVisible: true, poseAngle: 180 });
    await expect(page.getByText('Pose detected', { exact: true })).toBeVisible();
    // Lost frames consume no countdown time. Returning promptly resumes the
    // remaining two seconds instead of resetting to five or starting early.
    await expect(remaining).toHaveText('2');
    const resumedAt = Date.now();
    await changePose(page, { poseAngle: 150 });
    // Assert the outcome and elapsed time: browser scheduling can skip a
    // transient displayed digit even when the remaining clock is correct.
    await expect(active).toBeVisible({ timeout: 4000 });
    expect(Date.now() - resumedAt).toBeGreaterThan(800);
    await expect(reps).toHaveText('00');
    // Starting during a tolerated stance change still creates a complete rep
    // origin; the first controlled squat is counted normally after Go.
    await moveThroughAngles(page, [135, 120, 105, 95]);
    await expect(page.locator('.phase-text')).toHaveText('lowered');
    await page.waitForTimeout(650);
    await moveThroughAngles(page, [105, 125, 145, 165, 180]);
    await expect(reps).toHaveText('01');
  } finally {
    await browser.close();
  }
});
