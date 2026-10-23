import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { provisionTestAdmin } from './support/admin';
process.loadEnvFile('.env');
test('admin invites a coach, assigns a walk-in, and trainee books a studio class on mobile', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const db = new PrismaClient(),
    key = randomUUID(),
    ids: string[] = [],
    headers = { Origin: 'http://localhost:3000' };
  const contexts = await Promise.all(
    [0, 1, 2].map(() =>
      browser.newContext({
        viewport: { width: 390, height: 844 },
        extraHTTPHeaders: { 'x-forwarded-for': `2001:db8:${randomBytes(2).toString('hex')}::1` },
      }),
    ),
  );
  const [admin, coach, trainee] = await Promise.all(contexts.map((c) => c.newPage()));
  let studioId = '';
  try {
    for (const [i, page] of [admin, coach, trainee].entries()) {
      const signup = await page.request.post('/api/auth/sign-up/email', {
        headers,
        data: {
          name: ['Role Admin', 'Role Coach', 'Role Trainee'][i],
          email: `browser-role-${i}-${key}@example.test`,
          password: randomBytes(24).toString('base64url'),
        },
      });
      expect(signup.ok()).toBe(true);
      ids.push((await signup.json()).user.id);
      expect(
        (
          await page.request.post('/api/command', {
            headers,
            data: {
              action: 'onboard',
              role: 'trainee',
              name: ['Role Admin', 'Role Coach', 'Role Trainee'][i],
              adult: true,
            },
          })
        ).ok(),
      ).toBe(true);
      await db.user.update({ where: { id: ids[i] }, data: { emailVerified: true } });
    }
    const studio = await provisionTestAdmin(db, ids[0]);
    studioId = studio.id;
    await admin.goto('/app?view=staff');
    await admin.getByLabel('Coach’s personal email').fill(`browser-role-1-${key}@example.test`);
    await admin.getByRole('button', { name: 'Send coach invitation email' }).click();
    await expect(admin.locator('.team-access').getByRole('alert')).toContainText(
      'request is saved',
    );
    await expect(admin.getByText('Awaiting acceptance', { exact: true })).toBeVisible();
    await coach.goto('/app');
    await coach.getByRole('button', { name: 'Accept coach invitation' }).click();
    await expect(
      coach.getByRole('link', { name: /^Coaching clients/, includeHidden: true }),
    ).toBeAttached();
    await expect(
      coach.getByRole('link', { name: 'Payments', exact: true, includeHidden: true }),
    ).toHaveCount(0);
    await admin.goto('/app?view=members');
    await admin.getByRole('button', { name: 'Add member', exact: true }).first().click();
    await admin.getByLabel('Full name', { exact: true }).fill('Walk-in Trainee');
    await expect(admin.getByRole('dialog')).toContainText('In-person member');
    await admin.getByRole('button', { name: 'Save changes', exact: true }).click();
    await admin.goto('/app?view=staff');
    await admin.getByLabel('Primary coach for Walk-in Trainee').selectOption(ids[1]);
    await expect(
      admin.getByRole('status').filter({ hasText: 'Team access updated' }),
    ).toBeVisible();
    await coach.goto('/app?view=clients');
    await coach.getByText('Walk-in Trainee', { exact: true }).click();
    await coach.getByLabel('Training goal for Walk-in Trainee').fill('Better mobility');
    await coach.getByLabel('Coaching note for Walk-in Trainee').fill('Begin with gentle warmups');
    await coach.getByRole('button', { name: 'Save coaching details' }).click();
    await expect(
      coach.getByRole('status').filter({ hasText: 'Coaching details saved' }),
    ).toBeVisible();
    const offer = await db.membershipOffer.create({
      data: { studioId, name: 'Browser term', durationDays: 365, pricePaise: 100000 },
    });
    const member = await db.studioMember.create({
      data: {
        studioId,
        userId: ids[2],
        name: 'Role Trainee',
        email: `browser-role-2-${key}@example.test`,
        joinedOn: '2020-01-01',
      },
    });
    await db.membership.create({ data: { studioId, userId: ids[2] } });
    await db.studioRoleGrant.create({ data: { studioId, userId: ids[2], role: 'trainee' } });
    await db.memberTerm.create({
      data: {
        studioId,
        memberId: member.id,
        offerId: offer.id,
        planName: offer.name,
        feePaise: offer.pricePaise,
        startsOn: '2020-01-01',
        endsOn: '2099-12-31',
      },
    });
    await db.studioClass.create({
      data: {
        studioId,
        hostId: ids[1],
        trainer: 'Role Coach',
        title: 'Mobility class',
        startsAt: new Date(Date.now() + 86400000),
        location: 'Main studio',
        duration: 45,
        capacity: 1,
      },
    });
    await trainee.goto('/app?view=benefits');
    await trainee.getByRole('button', { name: 'Book my place' }).click();
    await expect(trainee.getByRole('button', { name: 'Cancel my booking' })).toBeVisible();
    await trainee.getByRole('button', { name: 'Cancel my booking' }).click();
    await expect(
      trainee.getByRole('status').filter({ hasText: 'Booking cancelled' }),
    ).toBeVisible();
    for (const page of [admin, coach, trainee]) {
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true);
    }
    await admin.screenshot({ path: 'docs/screenshots/studio-team-mobile.png', fullPage: true });
  } finally {
    if (studioId) await db.coachAssignmentHistory.deleteMany({ where: { studioId } });
    await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
    await Promise.all(contexts.map((c) => c.close()));
  }
});
