import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
process.loadEnvFile('.env');
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

test('manual activity saves, resumes after reload, and retains an audited correction', async ({
  page,
}) => {
  test.setTimeout(60000);
  const db = new PrismaClient(),
    email = `manual-${randomUUID()}@example.test`;
  await page
    .context()
    .setExtraHTTPHeaders({ 'x-forwarded-for': `2001:db8:${randomBytes(2).toString('hex')}::1` });
  try {
    const signup = await page.request.post('/api/auth/sign-up/email', {
      headers: { Origin: 'http://localhost:3000' },
      data: { name: 'Manual trainee', email, password: randomBytes(24).toString('base64url') },
    });
    expect(signup.ok()).toBe(true);
    expect(
      (
        await page.request.post('/api/command', {
          headers: { Origin: 'http://localhost:3000' },
          data: { action: 'onboard', role: 'trainee', name: 'Manual trainee', adult: true },
        })
      ).ok(),
    ).toBe(true);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    await page.goto('/app?view=practice');
    await page.getByLabel('Exercise to practice').selectOption('gobletsquat');
    await expect(page.getByText('Manual repetitions', { exact: true })).toBeVisible();
    await page
      .getByRole('checkbox', { name: 'Save workout history to my profile and share with my coach' })
      .check();
    await page.getByRole('button', { name: 'Start set', exact: true }).click();
    await page.getByLabel('Manual repetitions').fill('1');
    await expect(page.getByText(/Observed activity: 1s/)).toBeVisible();
    await page.getByRole('button', { name: 'Finish set', exact: true }).click();
    await expect(page.getByText('Workout saved.', { exact: true })).toBeVisible();
    expect(await db.workoutSet.count({ where: { userId: user.id } })).toBe(1);
    await page.reload();
    await page.getByLabel('Exercise to practice').selectOption('gobletsquat');
    await expect(page.getByText(/Confirmed results restored/)).toBeVisible();
    await expect(page.getByText('Set 2 of 3', { exact: true })).toBeVisible();
    expect(await db.workoutSet.count({ where: { userId: user.id } })).toBe(1);
    await page.goto('/app?view=analytics');
    const record = page.locator('.workout-record').first();
    await expect(record).toContainText('Goblet squat');
    await record.getByText('Exercise record details', { exact: true }).click();
    await record.getByRole('button', { name: 'Correct this result' }).click();
    await record.getByLabel('Repetitions', { exact: true }).fill('2');
    await record.getByLabel('Reason').fill('Corrected a manual counting mistake.');
    await record.getByRole('button', { name: 'Save correction', exact: true }).click();
    await expect(
      page.locator('.workout-record').first().locator('> div').nth(1).locator('strong'),
    ).toHaveText('2 reps');
    await expect
      .poll(() => db.workoutCorrection.count({ where: { set: { userId: user.id } } }))
      .toBe(1);
    const saved = await db.workoutSet.findFirstOrThrow({
      where: { userId: user.id },
      include: { corrections: true },
    });
    expect(saved.reps).toBe(1);
    expect(saved.corrections[0].reps).toBe(2);
    await mkdir('docs/screenshots', { recursive: true });
    await page.screenshot({ path: 'docs/screenshots/coaching-v2-corrected-history.png' });
  } finally {
    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      await db.auditEvent.deleteMany({ where: { actorId: user.id } });
      await db.user.delete({ where: { id: user.id } });
    }
    await db.$disconnect();
  }
});

test('bilateral curl UI ignores a single arm and persists per-arm measurements', async ({
  page,
}) => {
  test.setTimeout(60000);
  const db = new PrismaClient(),
    email = `bilateral-${randomUUID()}@example.test`;
  await page
    .context()
    .setExtraHTTPHeaders({ 'x-forwarded-for': `2001:db8:${randomBytes(2).toString('hex')}::1` });
  await page.addInitScript(() => {
    const fixture = window as unknown as { armAngles: number[] };
    fixture.armAngles = [170, 170];
    class PoseWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      postMessage(data: {
        type: string;
        width: number;
        height: number;
        timestamp: number;
        bitmap?: ImageBitmap;
      }) {
        if (data.type === 'init') {
          setTimeout(
            () => this.onmessage?.({ data: { type: 'ready', variant: 'heavy', delegate: 'CPU' } }),
            10,
          );
          return;
        }
        const pose = Array.from({ length: 33 }, () => ({
          x: 0.5,
          y: 0.5,
          visibility: 0.95,
          presence: 0.95,
        }));
        for (const side of [0, 1]) {
          const x = side ? 0.7 : 0.3,
            rad = (fixture.armAngles[side] * Math.PI) / 180;
          pose[11 + side] = { x, y: 0.2, visibility: 0.95, presence: 0.95 };
          pose[13 + side] = { x, y: 0.42, visibility: 0.95, presence: 0.95 };
          pose[15 + side] = {
            x: x + (Math.sin(rad) * 0.22 * data.height) / data.width,
            y: 0.42 - Math.cos(rad) * 0.22,
            visibility: 0.95,
            presence: 0.95,
          };
          pose[23 + side] = { x, y: 0.65, visibility: 0.95, presence: 0.95 };
        }
        data.bitmap?.close();
        setTimeout(
          () =>
            this.onmessage?.({
              data: {
                type: 'result',
                poses: [pose],
                timestamp: data.timestamp,
                width: data.width,
                height: data.height,
                inferenceMs: 8,
              },
            }),
          5,
        );
      }
      terminate() {}
    }
    window.Worker = PoseWorker as unknown as typeof Worker;
  });
  try {
    expect(
      (
        await page.request.post('/api/auth/sign-up/email', {
          headers: { Origin: 'http://localhost:3000' },
          data: {
            name: 'Bilateral trainee',
            email,
            password: randomBytes(24).toString('base64url'),
          },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await page.request.post('/api/command', {
          headers: { Origin: 'http://localhost:3000' },
          data: { action: 'onboard', role: 'trainee', name: 'Bilateral trainee', adult: true },
        })
      ).ok(),
    ).toBe(true);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    await page.goto('/app?view=practice');
    await page.getByLabel('Exercise to practice').selectOption('curl');
    await page
      .getByRole('checkbox', { name: 'Save workout history to my profile and share with my coach' })
      .check();
    await page.getByLabel('Curl workout mode').selectOption('both');
    await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
    await expect(page.getByText('Pose detected', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start set', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause set', exact: true })).toBeVisible();
    await expect(page.getByLabel('Curl workout mode')).toBeDisabled();
    async function curl(both: boolean) {
      for (const angle of [170, 150, 120, 85, 45, 0, 30, 70, 100, 130, 160, 170]) {
        await page.evaluate(
          ({ angle, both }) => {
            (window as unknown as { armAngles: number[] }).armAngles = [angle, both ? angle : 170];
          },
          { angle, both },
        );
        await page.waitForTimeout(100);
      }
    }
    await curl(false);
    await expect(page.getByTestId('cumulative-reps')).toHaveText('00');
    await expect(page.getByLabel('Per-arm progress')).toContainText('Left 1');
    await curl(true);
    await expect(page.getByTestId('cumulative-reps')).toHaveText('01');
    await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
    await page.getByRole('button', { name: 'Finish set early', exact: true }).click();
    await expect.poll(() => db.workoutSet.count({ where: { userId: user.id } })).toBe(1);
    const saved = await db.workoutSet.findFirstOrThrow({ where: { userId: user.id } });
    expect(saved.reps).toBe(1);
    const m = saved.measurement as {
      armMode: string;
      arms: { left: { reps: number }; right: { reps: number } };
    };
    expect(m.armMode).toBe('both');
    expect(m.arms.left.reps).toBe(2);
    expect(m.arms.right.reps).toBe(1);
  } finally {
    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      await db.auditEvent.deleteMany({ where: { actorId: user.id } });
      await db.user.delete({ where: { id: user.id } });
    }
    await db.$disconnect();
  }
});
