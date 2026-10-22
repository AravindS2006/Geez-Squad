import { grantStudioTerm } from './support/membership';
import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

process.loadEnvFile('.env');

for (const traineeCount of [8, 30, 48]) {
  test(`${traineeCount} trainees are accessible on phones, laptops, and TVs`, async ({ page }) => {
    test.setTimeout(60000);
    const fixtureId = randomUUID();
    const email = `gallery-coach-${fixtureId}@example.test`;
    const db = new PrismaClient();
    const traineeIds = Array.from({ length: traineeCount }, () => randomUUID());
    const traineeNames = traineeIds.map((_, index) => `Gallery Trainee ${index + 1}`);
    await page.context().setExtraHTTPHeaders({
      'x-forwarded-for': `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`,
    });
    const headers = { Origin: 'http://localhost:3000' };
    try {
      const signup = await page.request.post('/api/auth/sign-up/email', {
        headers,
        data: { name: 'Gallery Coach', email, password: 'Local-Integration-Only-12345' },
      });
      expect(signup.ok()).toBe(true);
      const setup = await page.request.post('/api/command', {
        headers,
        data: { action: 'onboard', name: 'Gallery Coach', role: 'coach', adult: true },
      });
      expect(setup.ok()).toBe(true);
      const coach = await db.user.findUniqueOrThrow({ where: { email } });
      const studio = await db.studio.findUniqueOrThrow({ where: { ownerId: coach.id } });
      // Only these disposable local users are enrolled; no real accounts or rooms are changed.
      await db.$transaction(
        traineeIds.map((id, index) =>
          db.user.create({
            data: {
              id,
              name: traineeNames[index],
              email: `gallery-trainee-${index}-${fixtureId}@example.test`,
              role: 'trainee',
              memberships: { create: { studioId: studio.id } },
            },
          }),
        ),
      );
      for (const clientId of traineeIds) await grantStudioTerm(db, clientId);
      const scheduled = await page.request.post('/api/command', {
        headers,
        data: {
          action: 'createClass',
          title: 'Full gallery rehearsal',
          startsAt: new Date(Date.now() + 3600000).toISOString(),
          duration: 30,
          capacity: 1,
          includeAllClients: true,
          participantIds: [],
        },
      });
      expect(scheduled.ok()).toBe(true);
      const session = await scheduled.json();
      const started = await page.request.post('/api/command', {
        headers,
        data: { action: 'classControl', id: session.id, control: 'start' },
      });
      expect(started.ok()).toBe(true);
      await db.enrollment.update({
        where: { classId_userId: { classId: session.id, userId: traineeIds[0] } },
        data: {
          metric: {
            create: {
              exercise: 'squat',
              revision: 0,
              reps: 5,
              score: 83,
              confidence: 0.95,
              phase: 'working',
              cue: 'Return to standing under control.',
            },
          },
        },
      });
      await db.enrollment.update({
        where: { classId_userId: { classId: session.id, userId: traineeIds[traineeCount - 1] } },
        data: { helpRequested: true },
      });
      await page.goto(`/studio/${session.id}`);
      const tiles = traineeNames.map((name) =>
        page.getByRole('button', { name: new RegExp(`^Focus ${name}(?:,|$)`) }),
      );
      await expect(tiles[0].locator('.participant-stats')).toContainText('5');
      await expect(tiles[0].locator('.participant-stats')).toContainText('83');
      if (traineeCount <= 36) await expect(tiles[traineeCount - 1]).toContainText('Help requested');
      const visibleCount = Math.min(traineeCount, 36);
      const cameraTiles = tiles.slice(0, visibleCount);
      if (traineeCount > 36) {
        await expect(page.locator('.participant-grid .participant-tile')).toHaveCount(36);
        await page.getByRole('button', { name: 'Next trainees' }).click();
        await expect(tiles[traineeCount - 1]).toBeVisible();
        await expect(page.locator('.participant-grid .participant-tile')).toHaveCount(
          traineeCount - 36,
        );
        await page.getByRole('button', { name: 'Previous trainees' }).click();
      }
      for (const viewport of [
        { width: 320, height: 568 },
        { width: 390, height: 844 },
        { width: 844, height: 390 },
        { width: 1440, height: 900 },
        { width: 3840, height: 2160 },
      ]) {
        await page.setViewportSize(viewport);
        await expect(page.locator('.participant-grid .participant-tile')).toHaveCount(visibleCount);
        await expect(page.locator('.participant-grid .meeting-tile')).toHaveCount(visibleCount);
        await tiles[visibleCount - 1].click();
        await expect(tiles[visibleCount - 1]).toHaveAttribute('aria-pressed', 'true');
        await expect(
          page.getByRole('complementary', { name: 'Selected trainee details' }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Close trainee details' }).click();
        if (traineeCount > 8) {
          await page.locator('.meeting-gallery .meeting-tile').last().scrollIntoViewIfNeeded();
          const geometry = await page.locator('.meeting-gallery').evaluate((element) => ({
            scrollTop: element.scrollTop,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
            rows: getComputedStyle(element).gridTemplateRows,
            autoRows: getComputedStyle(element).gridAutoRows,
            overflow: getComputedStyle(element).overflowY,
            classes: element.className,
          }));
          await mkdir('docs/screenshots', { recursive: true });
          await page.screenshot({
            path: `docs/screenshots/gallery-${traineeCount}-${viewport.width}.png`,
          });
          if (geometry.scrollHeight > geometry.clientHeight)
            expect(geometry.scrollTop, JSON.stringify({ viewport, ...geometry })).toBeGreaterThan(
              0,
            );
          if (viewport.width >= 951) {
            expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight + 1);
          }
          if (viewport.width === 3840 && traineeCount <= 30) {
            const gallery = await page.locator('.meeting-gallery').boundingBox();
            const lastTile = await page
              .locator('.meeting-gallery .meeting-tile')
              .last()
              .boundingBox();
            expect(lastTile!.height).toBeGreaterThan(300);
            expect(
              Math.abs(lastTile!.y + lastTile!.height - gallery!.y - gallery!.height),
            ).toBeLessThan(3);
          }
        }
        for (const tile of cameraTiles) {
          await expect(tile).toBeVisible();
          const box = await tile.boundingBox();
          expect(box, `tile is rendered at ${viewport.width}×${viewport.height}`).not.toBeNull();
          expect(box!.x).toBeGreaterThanOrEqual(-1);
          if (viewport.width >= 951) expect(box!.y).toBeGreaterThanOrEqual(-1);
          expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
          if (viewport.width >= 951)
            expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
          else expect(box!.height).toBeGreaterThanOrEqual(100);
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        const dock = await page.locator('.meeting-dock').boundingBox();
        expect(dock).not.toBeNull();
        expect(dock!.y + dock!.height).toBeLessThanOrEqual(viewport.height + 1);
        // Changing the recipient preserves the entire gallery instead of replacing it with one tile.
        await expect(tiles[visibleCount - 1]).toHaveAttribute('aria-pressed', 'false');
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByLabel('Find a trainee').fill(traineeNames[traineeCount - 1]);
      await expect(page.locator('.participant-grid .participant-tile')).toHaveCount(1);
      await tiles[traineeCount - 1].click();
      await page.getByLabel('Private coaching cue').fill('Keep your movement controlled.');
      await page.getByRole('button', { name: 'Send private cue', exact: true }).click();
      await expect(page.getByLabel('Private coaching cue')).toHaveValue('');
      const savedCue = await db.message.findFirst({
        where: { classId: session.id, recipientId: traineeIds[traineeCount - 1] },
      });
      expect(savedCue?.text).toBe('Keep your movement controlled.');
      await page.getByRole('button', { name: 'Mark help addressed' }).click();
      await expect(page.getByRole('button', { name: 'Mark help addressed' })).toHaveCount(0);
      const accessibility = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        accessibility.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
    } finally {
      const coach = await db.user.findUnique({ where: { email }, select: { id: true } });
      const ids = coach ? [coach.id, ...traineeIds] : traineeIds;
      await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      await db.$disconnect();
    }
  });
}
