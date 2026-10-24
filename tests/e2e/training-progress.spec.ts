import { provisionTestAdmin } from './support/admin';
import { grantStudioTerm } from './support/membership';
import { test, expect, chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import { randomUUID, randomBytes } from 'node:crypto';
import { addPoseFixture, moveThroughAngles } from './support/pose-fixture';
process.loadEnvFile('.env');
test('coach assignments, check-ins, private notes and a retried camera set persist through reload', async () => {
  test.setTimeout(90000);
  const db = new PrismaClient();
  const id = randomUUID();
  const emails = [`progress-coach-${id}@example.test`, `progress-trainee-${id}@example.test`];
  const browser = await chromium.launch({
    channel: 'msedge',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const contexts = await Promise.all(
    emails.map(() =>
      browser.newContext({
        viewport: { width: 390, height: 844 },
        extraHTTPHeaders: {
          'x-forwarded-for': `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`,
        },
      }),
    ),
  );
  const [coach, trainee] = await Promise.all(contexts.map((context) => context.newPage()));
  const origin = 'http://localhost:3000',
    headers = { Origin: origin };
  const users: string[] = [];
  try {
    for (const [page, email, name, role] of [
      [coach, emails[0], 'Progress Coach', 'coach'],
      [trainee, emails[1], 'Progress Trainee', 'trainee'],
    ] as const) {
      const signup = await page.request.post(`${origin}/api/auth/sign-up/email`, {
        headers,
        data: { email, name, password: 'Local-Integration-Only-12345' },
      });
      expect(signup.ok()).toBe(true);
      users.push((await signup.json()).user.id);
      if (role === 'coach') await provisionTestAdmin(db, email);
      expect(
        (
          await page.request.post(`${origin}/api/command`, {
            headers,
            data: { action: 'onboard', name, role: 'trainee', adult: true },
          })
        ).ok(),
      ).toBe(true);
    }
    const invited = await coach.request.post(`${origin}/api/command`, {
      headers,
      data: { action: 'invite', email: emails[1] },
    });
    expect(
      (
        await trainee.request.post(`${origin}/api/command`, {
          headers,
          data: { action: 'acceptInvite', code: (await invited.json()).code },
        })
      ).ok(),
    ).toBe(true);
    await grantStudioTerm(db, emails[1]);
    const createdPlan = await coach.request.post(`${origin}/api/command`, {
      headers,
      data: {
        action: 'savePlan',
        name: 'Assigned foundations',
        description: 'One controlled squat',
        blocks: [{ exercise: 'squat', sets: 1, reps: 1, rest: 0, loadKg: 5, loadBasis: 'total' }],
      },
    });
    expect(createdPlan.ok()).toBe(true);
    const plan = await createdPlan.json();
    await coach.goto('/app?view=clients');
    await coach
      .getByRole('button', { name: /Progress Trainee/ })
      .first()
      .click();
    await coach.getByLabel('Assigned workout plan').selectOption(plan.id);
    await coach.getByRole('button', { name: 'Save assignment', exact: true }).click();
    await expect(coach.getByRole('status').filter({ hasText: 'Assignment saved.' })).toBeVisible();
    await coach.getByLabel('Private coach notes').fill('Coach-only technique observation');
    await coach.getByRole('button', { name: 'Save coach note', exact: true }).click();
    await expect(
      coach.getByRole('status').filter({ hasText: 'Private coach note saved.' }),
    ).toBeVisible();
    await trainee.goto('/app');
    await expect(trainee.getByText(/Your coach assigned Assigned foundations/)).toBeVisible();
    await trainee.getByRole('button', { name: 'Share a check-in', exact: true }).click();
    await trainee.getByLabel('Workout effort (1–10, optional)').fill('7');
    await trainee.getByLabel('Sleep (hours, optional)').fill('8');
    await trainee.getByLabel('Anything your coach should know?').fill('Recovered well');
    await trainee.getByRole('button', { name: 'Share check-in with my coach' }).click();
    await expect(
      trainee.getByRole('status').filter({ hasText: 'Your check-in is saved.' }),
    ).toBeVisible();
    await trainee.getByRole('button', { name: 'Close dialog' }).click();
    await coach.reload();
    await coach
      .getByRole('button', { name: /Progress Trainee/ })
      .first()
      .click();
    await expect(coach.getByText('Recovered well', { exact: true })).toBeVisible();
    await expect(coach.getByLabel('Private coach notes')).toHaveValue(
      'Coach-only technique observation',
    );
    await addPoseFixture(trainee);
    await trainee.goto('/app?view=practice');
    await expect(
      trainee.getByLabel('Save workout history to my profile and share with my coach'),
    ).not.toBeChecked();
    await trainee.getByLabel('Assigned plan exercise').selectOption('0');
    await trainee.getByLabel('Save workout history to my profile and share with my coach').check();
    let requests = 0;
    await trainee.route('**/api/workout-sets', async (route) => {
      requests++;
      if (requests === 1)
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Temporary connection failure' }),
        });
      else await route.continue();
    });
    await trainee.getByRole('button', { name: 'Enable camera', exact: true }).click();
    await expect(trainee.getByText('Pose detected', { exact: true })).toBeVisible();
    await trainee.getByRole('button', { name: 'Start set', exact: true }).click();
    await expect(trainee.getByRole('button', { name: 'Pause set', exact: true })).toBeVisible({
      timeout: 15000,
    });
    await moveThroughAngles(trainee, [165, 150, 135, 120, 105, 95]);
    await trainee.waitForTimeout(350);
    await moveThroughAngles(trainee, [105, 120, 135, 150, 165, 180]);
    await expect(trainee.getByTestId('cumulative-reps')).toHaveText('01');
    await expect(trainee.getByRole('button', { name: 'Retry saving', exact: true })).toBeVisible();
    await expect(trainee.locator('.set-completion')).toContainText('Set 1 complete · 1/1 reps');
    const completionText = await trainee.locator('.set-completion strong').textContent();
    expect(
      await trainee.evaluate(
        () => JSON.parse(localStorage.getItem('geez-squad:pending-sets:v1') ?? '[]').length,
      ),
    ).toBe(1);
    await trainee.getByRole('button', { name: 'Retry saving', exact: true }).click();
    await expect(trainee.getByRole('status').filter({ hasText: 'Workout saved' })).toBeVisible();
    await expect(trainee.locator('.set-completion strong')).toHaveText(completionText!);
    await trainee.goto('/app?view=analytics');
    await expect(trainee.getByText('Recent workout sets', { exact: true })).toBeVisible();
    await trainee.reload();
    const saved = await db.workoutSet.findMany({ where: { userId: users[1] } });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      reps: 1,
      target: 1,
      completed: true,
      exercise: 'squat',
      loadKg: 5,
    });
    expect(saved[0].measurement).toMatchObject({ loadBasis: 'total' });
    expect(saved[0].qualityScore).toBeGreaterThan(0);
    expect(saved[0].trackedMs).toBeGreaterThan(0);
    await trainee.getByText('Measurement details', { exact: true }).click();
    await expect(
      trainee.locator('.progress-metric').filter({ hasText: 'Reported load volume' }),
    ).toContainText('5 kg·reps');
    const downloaded = trainee.waitForEvent('download');
    await trainee.getByRole('button', { name: 'Export CSV' }).click();
    expect((await downloaded).suggestedFilename()).toBe('geez-squad-workouts.csv');
    expect((await trainee.request.get('/api/workspace')).ok()).toBe(true);
    expect(
      JSON.stringify(await (await trainee.request.get('/api/workspace')).json()),
    ).not.toContain('Coach-only technique observation');
    expect(
      (
        await new AxeBuilder({ page: trainee })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(await trainee.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await trainee.evaluate(
        () => JSON.parse(localStorage.getItem('geez-squad:pending-sets:v1') ?? '[]').length,
      ),
    ).toBe(0);
    // Leaving an unfinished, consented set must retain its measured work once.
    await trainee.goto('/app?view=practice');
    await trainee.getByLabel('Assigned plan exercise').selectOption('0');
    await trainee.getByRole('button', { name: 'New workout', exact: true }).click();
    await trainee.getByLabel('Save workout history to my profile and share with my coach').check();
    await trainee.getByRole('button', { name: 'Workout settings', exact: true }).click();
    await trainee.getByLabel('Reps per set').fill('2');
    await trainee.getByRole('button', { name: 'Close dialog' }).click();
    await trainee.getByRole('button', { name: 'Enable camera', exact: true }).click();
    await expect(trainee.getByText('Pose detected', { exact: true })).toBeVisible();
    await expect(trainee.getByTestId('cumulative-reps')).toHaveText('01');
    await trainee.getByRole('button', { name: 'Start set', exact: true }).click();
    await expect(trainee.getByRole('button', { name: 'Pause set', exact: true })).toBeVisible({
      timeout: 15000,
    });
    await moveThroughAngles(trainee, [165, 150, 135, 120, 105, 95]);
    await trainee.waitForTimeout(350);
    await moveThroughAngles(trainee, [105, 120, 135, 150, 165, 180]);
    await expect(trainee.getByTestId('cumulative-reps')).toHaveText('02');
    await trainee.getByRole('link', { name: 'Back to workspace', exact: true }).click();
    await expect(trainee).not.toHaveURL(/view=practice/);
    await trainee.getByRole('button', { name: 'Open navigation' }).click();
    await trainee.getByRole('link', { name: 'Insights', exact: true }).click();
    await expect(trainee).toHaveURL(/view=analytics/);
    await expect.poll(() => db.workoutSet.count({ where: { userId: users[1] } })).toBe(2);
    const interrupted = await db.workoutSet.findFirstOrThrow({
      where: { userId: users[1], completed: false },
    });
    expect(interrupted).toMatchObject({ reps: 1, target: 2, exercise: 'squat' });
    expect(interrupted.activeMs).toBeGreaterThan(0);
    await trainee.reload();
    await expect(trainee.getByText('Finished early', { exact: true })).toBeVisible();
  } finally {
    await db.auditEvent.deleteMany({ where: { actorId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
    await browser.close();
  }
});
