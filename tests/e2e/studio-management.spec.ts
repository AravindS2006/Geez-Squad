import { grantStudioTerm } from './support/membership';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
process.loadEnvFile('.env');

test('coach reschedules a class, changes its roster, manages a profile, and removes future access', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const db = new PrismaClient(),
    key = randomUUID(),
    origin = 'http://localhost:3000';
  const contexts = await Promise.all(
    [0, 1, 2].map(() =>
      browser.newContext({
        viewport: { width: 390, height: 844 },
        extraHTTPHeaders: {
          'x-forwarded-for': `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`,
        },
      }),
    ),
  );
  const [coach, first, second] = await Promise.all(contexts.map((context) => context.newPage()));
  const ids: string[] = [],
    headers = { Origin: origin };
  const errors: string[] = [];
  [coach, first, second].forEach((page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  );
  try {
    for (const [index, page, name, role] of [
      [0, coach, 'Management Coach', 'coach'],
      [1, first, 'First Trainee', 'trainee'],
      [2, second, 'Second Trainee', 'trainee'],
    ] as const) {
      const signup = await page.request.post(`${origin}/api/auth/sign-up/email`, {
        headers,
        data: {
          name,
          email: `management-${index}-${key}@example.test`,
          password: randomBytes(24).toString('base64url'),
        },
      });
      expect(signup.ok()).toBe(true);
      ids.push((await signup.json()).user.id);
      expect(
        (
          await page.request.post(`${origin}/api/command`, {
            headers,
            data: { action: 'onboard', name, role, adult: true },
          })
        ).ok(),
      ).toBe(true);
      if (index) {
        const invite = await coach.request.post(`${origin}/api/command`, {
          headers,
          data: { action: 'invite', email: `management-${index}-${key}@example.test` },
        });
        expect(invite.ok()).toBe(true);
        expect(
          (
            await page.request.post(`${origin}/api/command`, {
              headers,
              data: { action: 'acceptInvite', code: (await invite.json()).code },
            })
          ).ok(),
        ).toBe(true);
      }
    }
    for (const clientId of ids.slice(1)) await grantStudioTerm(db, clientId);
    const created = await coach.request.post(`${origin}/api/command`, {
      headers,
      data: {
        action: 'createClass',
        title: 'Original training class',
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        duration: 30,
        capacity: 30,
        participantIds: [ids[1]],
      },
    });
    expect(created.ok()).toBe(true);
    const sessionId = (await created.json()).id;
    await coach.goto('/app?view=sessions');
    await coach.getByRole('button', { name: 'Edit Original training class', exact: true }).click();
    await expect(coach.getByLabel('Session title')).toHaveValue('Original training class');
    const newTime = new Date(Date.now() + 3 * 3600000);
    const localTime = new Date(newTime.getTime() - newTime.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    // Browser timezone may differ from the runner, so construct the local input in the browser.
    const inputTime = await coach.evaluate((iso) => {
      const date = new Date(iso);
      return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }, newTime.toISOString());
    expect(localTime).toBeTruthy();
    await coach.getByLabel('Session title').fill('Updated strength class');
    await coach.getByLabel('Date & time').fill(inputTime);
    await coach.getByLabel('Duration (minutes)').fill('60');
    await coach.getByRole('checkbox', { name: /First Trainee/ }).uncheck();
    await coach.getByRole('checkbox', { name: /Second Trainee/ }).check();
    expect(
      (await new AxeBuilder({ page: coach }).include('dialog[open]').analyze()).violations,
    ).toEqual([]);
    await coach.getByRole('button', { name: 'Save session changes', exact: true }).click();
    await expect(coach.getByRole('dialog')).toHaveCount(0);
    await coach.reload();
    await expect(
      coach.getByRole('button', { name: 'Edit Updated strength class', exact: true }),
    ).toBeVisible();
    const saved = await db.classSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { enrollments: true },
    });
    expect(saved.duration).toBe(60);
    expect(saved.enrollments.map((entry) => entry.userId)).toEqual([ids[2]]);
    expect(Math.abs(saved.startsAt.getTime() - newTime.getTime())).toBeLessThan(60000);
    await first.goto('/app?view=sessions');
    await expect(first.getByText('Updated strength class', { exact: true })).toHaveCount(0);
    await second.goto('/app?view=sessions');
    await expect(second.getByText('Updated strength class', { exact: true })).toBeVisible();
    await coach.goto('/app?view=clients');
    await coach
      .getByRole('button', { name: /Second Trainee/ })
      .first()
      .click();
    await coach.getByLabel('Trainee name', { exact: true }).fill('Updated Second Trainee');
    await coach.getByLabel('Training goal', { exact: true }).fill('Build strength twice a week');
    await coach.getByRole('button', { name: 'Save trainee profile', exact: true }).click();
    await expect(
      coach.getByRole('status').filter({ hasText: 'Trainee profile saved.' }),
    ).toBeVisible();
    await second.goto('/app');
    expect((await db.user.findUniqueOrThrow({ where: { id: ids[2] } })).goal).not.toBe(
      'Build strength twice a week',
    );
    expect((await db.studioMember.findFirstOrThrow({ where: { userId: ids[2] } })).goal).toBe(
      'Build strength twice a week',
    );
    await coach.getByText('Studio membership', { exact: true }).click();
    await coach.getByRole('button', { name: 'Remove from studio', exact: true }).click();
    await coach.getByRole('button', { name: 'Confirm removal', exact: true }).click();
    await expect(coach.getByRole('dialog')).toHaveCount(0);
    await coach.reload();
    await expect(coach.getByRole('button', { name: /Updated Second Trainee/ })).toHaveCount(0);
    await second.goto('/app?view=sessions');
    await expect(second.getByText('Updated strength class', { exact: true })).toHaveCount(0);
    expect(await db.user.count({ where: { id: ids[2] } })).toBe(1);
    expect(
      await second.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
