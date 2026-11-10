import { provisionTestAdmin } from './support/admin';
import { grantStudioTerm } from './support/membership';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { addPoseFixture } from './support/pose-fixture';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

process.loadEnvFile('.env');

/**
 * On a phone the trainee must be able to see their own movement. The live room keeps
 * its controls, but the camera gets most of the screen instead of a strip between
 * stacked panels.
 */
test('a trainee on a phone sees their own camera as the main view during a live class', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const fixtureId = randomUUID();
  const coachEmail = `mobile-coach-${fixtureId}@example.test`;
  const traineeEmail = `mobile-trainee-${fixtureId}@example.test`;
  const address = () =>
    `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`;
  const coach = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': address() } });
  const db = new PrismaClient();
  const origin = 'http://localhost:3000';
  const headers = { Origin: origin };
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': address() });
  try {
    for (const [request, name, email, role] of [
      [coach.request, 'Mobile Coach', coachEmail, 'coach'],
      [page.request, 'Mobile Trainee', traineeEmail, 'trainee'],
    ] as const) {
      const signup = await request.post(`${origin}/api/auth/sign-up/email`, {
        headers,
        data: { name, email, password: 'Local-Integration-Only-12345' },
      });
      expect(signup.ok()).toBe(true);
      if (role === 'coach') await provisionTestAdmin(db, email);
      expect(
        (
          await request.post(`${origin}/api/command`, {
            headers,
            data: { action: 'onboard', name, role: 'trainee', adult: true },
          })
        ).ok(),
      ).toBe(true);
    }
    const invite = await coach.request.post(`${origin}/api/command`, {
      headers,
      data: { action: 'invite', email: traineeEmail },
    });
    expect(
      (
        await page.request.post('/api/command', {
          headers,
          data: { action: 'acceptInvite', code: (await invite.json()).code },
        })
      ).ok(),
    ).toBe(true);
    const trainee = await db.user.findUniqueOrThrow({ where: { email: traineeEmail } });
    await grantStudioTerm(db, traineeEmail);
    const created = await coach.request.post(`${origin}/api/command`, {
      headers,
      data: {
        action: 'createClass',
        title: 'Phone camera check',
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        duration: 30,
        capacity: 2,
        participantIds: [trainee.id],
      },
    });
    const session = await created.json();
    expect(
      (
        await coach.request.post(`${origin}/api/command`, {
          headers,
          data: { action: 'classControl', id: session.id, control: 'start' },
        })
      ).ok(),
    ).toBe(true);
    // Cues hide themselves after 20 s, so each check sends a fresh one.
    const sendCue = async (text: string) =>
      expect(
        (
          await coach.request.post(`${origin}/api/command`, {
            headers,
            data: { action: 'message', id: session.id, text, kind: 'cue', recipientId: trainee.id },
          })
        ).ok(),
      ).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await addPoseFixture(page);
    await page.goto(`/studio/${session.id}`);
    await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
    await expect(page.getByText('Pose detected', { exact: true })).toBeVisible();
    const cue = page.locator('.meeting-human-cue');

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 360, height: 740 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      const cueText = `Keep your whole body visible at ${viewport.width}px.`;
      await sendCue(cueText);
      await expect(cue).toContainText(cueText);
      // Phones default to a floating coach so the trainee's own camera is the main view.
      await expect(page.locator('.trainee-video-layout')).toHaveClass(/coach-video-small/);
      const camera = (await page.locator('.camera-view').boundingBox())!;
      const share = camera.height / viewport.height;
      expect(share, `camera share at ${viewport.width}x${viewport.height}`).toBeGreaterThan(
        viewport.height < 600 ? 0.52 : viewport.height < 800 ? 0.7 : 0.75,
      );
      expect(camera.width).toBeGreaterThanOrEqual(viewport.width - 24);
      // The mode links share the camera's top bar instead of taking a row above it.
      const links = (await page.locator('.workout-capability').boundingBox())!;
      expect(links.y).toBeGreaterThanOrEqual(camera.y);
      expect(links.y + links.height).toBeLessThanOrEqual(camera.y + 64);
      // The coach tile stays inside the camera and clear of the trainee's own readouts.
      const tile = (await page.locator('.coach-stage').boundingBox())!;
      expect(tile.x).toBeGreaterThanOrEqual(camera.x);
      expect(tile.y).toBeGreaterThanOrEqual(camera.y);
      expect(tile.x + tile.width).toBeLessThanOrEqual(camera.x + camera.width);
      expect(tile.y + tile.height).toBeLessThanOrEqual(camera.y + camera.height);
      for (const readout of ['.analyzer-settings-button', '.tracking-badge', '.analyzer-hud']) {
        const r = (await page.locator(readout).boundingBox())!;
        const apart =
          r.x + r.width <= tile.x ||
          tile.x + tile.width <= r.x ||
          r.y + r.height <= tile.y ||
          tile.y + tile.height <= r.y;
        expect(apart, `coach tile clear of ${readout}`).toBe(true);
      }
      // The coach cue is a banner over the header instead of a row taken from the camera.
      const cueBox = (await cue.boundingBox())!;
      const header = (await page.locator('.meeting-header').boundingBox())!;
      expect(cueBox.y).toBeGreaterThanOrEqual(header.y);
      expect(cueBox.y + cueBox.height).toBeLessThanOrEqual(header.y + header.height);
      expect(cueBox.y + cueBox.height).toBeLessThanOrEqual(camera.y);
      // Every control stays on screen and nothing scrolls. Primary controls keep 44px
      // targets; the compact cue expander keeps the WCAG 2.2 AA 24px minimum.
      const controls = page.locator(
        '.meeting-dock button, .analyzer-footer button, .meeting-cue-dismiss',
      );
      for (const button of await controls.all()) {
        if (!(await button.isVisible())) continue;
        const b = (await button.boundingBox())!;
        const label = (await button.getAttribute('aria-label')) ?? (await button.textContent());
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(viewport.width);
        expect(b.y + b.height).toBeLessThanOrEqual(viewport.height);
        const secondary = await button.evaluate((node) => !!node.closest('.analyzer-cue'));
        expect(Math.min(b.width, b.height), `${label} target`).toBeGreaterThanOrEqual(
          secondary ? 24 : 44,
        );
      }
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= window.innerWidth &&
            document.documentElement.scrollHeight <= window.innerHeight,
        ),
      ).toBe(true);
      await mkdir('docs/screenshots', { recursive: true });
      await page.screenshot({
        path: `docs/screenshots/trainee-live-${viewport.width}x${viewport.height}.png`,
      });
      console.log(`camera ${viewport.width}x${viewport.height}: ${(share * 100).toFixed(1)}%`);
    }
    // Dismissing the cue returns the whole camera; a new cue would show again.
    await page.getByRole('button', { name: 'Dismiss coach message' }).click();
    await expect(cue).toBeHidden();
    // At rest the coach tile is video and name only. A tap shows its two controls at
    // full size, and they hide again on their own.
    const coachControls = page.locator('.coach-video-toolbar');
    const enlarge = page.getByRole('button', { name: 'Enlarge coach video' });
    await expect(coachControls).toHaveCSS('opacity', '0');
    await page.locator('#coach-video-feed').click();
    await expect(coachControls).toHaveCSS('opacity', '1');
    for (const control of [enlarge, page.getByRole('button', { name: 'Minimize coach video' })]) {
      const b = (await control.boundingBox())!;
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
    }
    await expect(coachControls).toHaveCSS('opacity', '0', { timeout: 8000 });
    // Keyboard focus shows them without a tap.
    await enlarge.focus();
    await expect(coachControls).toHaveCSS('opacity', '1');
    // A saved larger coach layout is still respected on a phone.
    await page.keyboard.press('Enter');
    await expect(page.locator('.trainee-video-layout')).toHaveClass(/coach-video-medium/);
    const a11y = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(a11y.violations.map((v) => v.id)).toEqual([]);
  } finally {
    const users = await db.user.findMany({
      where: { email: { in: [coachEmail, traineeEmail] } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
    await coach.close();
  }
});
