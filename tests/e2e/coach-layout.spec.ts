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

test('a trainee can resize, minimize, and restore the coach without replacing workout tracking', async ({
  page,
  browser,
}) => {
  // Five viewport sizes, every floating position, node preservation, and two axe scans.
  test.setTimeout(90000);
  const fixtureId = randomUUID();
  const coachEmail = `coach-layout-${fixtureId}@example.test`;
  const traineeEmail = `trainee-layout-${fixtureId}@example.test`;
  const address = () =>
    `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`;
  const coachAddress = address();
  const traineeAddress = address();
  const coach = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': coachAddress },
  });
  const db = new PrismaClient();
  const origin = 'http://localhost:3000';
  const headers = { Origin: origin };
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': traineeAddress });
  try {
    for (const [request, name, email, role] of [
      [coach.request, 'Layout Coach', coachEmail, 'coach'],
      [page.request, 'Layout Trainee', traineeEmail, 'trainee'],
    ] as const) {
      const signup = await request.post(`${origin}/api/auth/sign-up/email`, {
        headers,
        data: { name, email, password: 'Local-Integration-Only-12345' },
      });
      expect(signup.ok()).toBe(true);
      if (role === 'coach') await provisionTestAdmin(db, email);
      const setup = await request.post(`${origin}/api/command`, {
        headers,
        data: { action: 'onboard', name, role: 'trainee', adult: true },
      });
      expect(setup.ok()).toBe(true);
    }
    const invite = await coach.request.post(`${origin}/api/command`, {
      headers,
      data: { action: 'invite', email: traineeEmail },
    });
    expect(invite.ok()).toBe(true);
    const accepted = await page.request.post('/api/command', {
      headers,
      data: { action: 'acceptInvite', code: (await invite.json()).code },
    });
    expect(accepted.ok()).toBe(true);
    const trainee = await db.user.findUniqueOrThrow({ where: { email: traineeEmail } });
    await grantStudioTerm(db, traineeEmail);
    const created = await coach.request.post(`${origin}/api/command`, {
      headers,
      data: {
        action: 'createClass',
        title: 'Adjustable coach video',
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        duration: 30,
        capacity: 2,
        participantIds: [trainee.id],
      },
    });
    expect(created.ok()).toBe(true);
    const session = await created.json();
    const started = await coach.request.post(`${origin}/api/command`, {
      headers,
      data: { action: 'classControl', id: session.id, control: 'start' },
    });
    expect(started.ok()).toBe(true);
    await addPoseFixture(page);
    await page.goto(`/studio/${session.id}`);
    await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
    await expect(page.getByText('Pose detected', { exact: true })).toBeVisible();

    const size = page.locator('select[aria-label="Coach video size"]');
    const coachTile = page.locator('.coach-stage');
    const feed = page.locator('#coach-video-feed');
    const analyzer = page.locator('.camera-analyzer');
    await expect(size).toHaveValue('small');
    await expect(size).toBeHidden();
    await expect(page.getByRole('button', { name: 'Enlarge coach video' })).toBeVisible();
    await expect(analyzer).toBeVisible();
    // Layout changes must preserve the same camera and feed nodes, rather than remounting them.
    await analyzer.evaluate((node, id) => node.setAttribute('data-layout-fixture', id), fixtureId);
    await feed.evaluate((node, id) => node.setAttribute('data-layout-fixture', id), fixtureId);

    async function changeSize(value: string) {
      if ((await size.inputValue()) === value) return;
      if ((await size.inputValue()) === 'small') {
        await page.getByRole('button', { name: 'Enlarge coach video' }).click();
        await expect(size).toBeFocused();
      }
      if ((await size.inputValue()) !== value) await size.selectOption(value);
      if (value === 'small')
        await expect(page.getByRole('button', { name: 'Enlarge coach video' })).toBeFocused();
    }

    async function expectInsideCamera() {
      const camera = await page.locator('.camera-view').boundingBox();
      const tile = await coachTile.boundingBox();
      expect(tile).not.toBeNull();
      expect(camera).not.toBeNull();
      expect(tile!.x).toBeGreaterThanOrEqual(camera!.x);
      expect(tile!.y).toBeGreaterThanOrEqual(camera!.y);
      expect(tile!.x + tile!.width).toBeLessThanOrEqual(camera!.x + camera!.width);
      expect(tile!.y + tile!.height).toBeLessThanOrEqual(camera!.y + camera!.height);
    }

    async function expectCameraOverlaysAligned() {
      const camera = (await page.locator('.camera-view').boundingBox())!;
      const video = (await page.locator('.camera-video').boundingBox())!;
      const canvas = (await page.locator('.pose-canvas').boundingBox())!;
      expect(video).toEqual(canvas);
      const progress = (await page.locator('.analyzer-progress').boundingBox())!;
      const label = (await page
        .locator('.analyzer-progress > div:first-child > strong')
        .boundingBox())!;
      const inset = await page
        .locator('.analyzer-progress')
        .evaluate((node) => parseFloat(getComputedStyle(node).paddingLeft));
      expect(Math.abs(progress.x + inset - label.x)).toBeLessThanOrEqual(1);
      const overlays = [
        '.tracking-badge',
        '.analyzer-hud',
        '.camera-bottom > span:first-child',
        '.camera-bottom > span:last-child',
        '.coach-stage',
      ];
      const boxes: { selector: string; x: number; y: number; width: number; height: number }[] = [];
      for (const selector of overlays) {
        const node = page.locator(selector).first();
        if (!(await node.isVisible())) continue;
        const box = (await node.boundingBox())!;
        if (
          selector === '.coach-stage' &&
          !(await page
            .locator('.trainee-video-layout')
            .evaluate(
              (node) =>
                node.classList.contains('coach-video-small') ||
                node.classList.contains('coach-video-minimized'),
            ))
        )
          continue;
        expect(box.x, selector).toBeGreaterThanOrEqual(camera.x);
        expect(box.y, selector).toBeGreaterThanOrEqual(camera.y);
        expect(box.x + box.width, selector).toBeLessThanOrEqual(camera.x + camera.width);
        expect(box.y + box.height, selector).toBeLessThanOrEqual(camera.y + camera.height);
        boxes.push({ selector, ...box });
      }
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i],
            b = boxes[j];
          const overlap =
            Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
            Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
          expect(
            overlap,
            `${a.selector} ${JSON.stringify(a)} overlaps ${b.selector} ${JSON.stringify(b)} at ${JSON.stringify(page.viewportSize())} ${await page.locator('.trainee-video-layout').getAttribute('class')} ${await page.locator('.trainee-video-layout').getAttribute('data-coach-position')}`,
          ).toBe(false);
        }
      for (const selector of [
        '.camera-view',
        '.pose-canvas',
        '.camera-bottom',
        '.analyzer-topbar',
        '.coach-stage',
        '.coach-video-toolbar',
        '.meeting-tile-name',
      ]) {
        const styles = await page
          .locator(selector)
          .first()
          .evaluate((node) => ({
            image: getComputedStyle(node).backgroundImage,
            shadow: getComputedStyle(node).boxShadow,
          }));
        expect(styles, selector).toEqual({ image: 'none', shadow: 'none' });
      }
    }

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 1440, height: 900 },
      { width: 3840, height: 2160 },
    ]) {
      await page.setViewportSize(viewport);
      let previousSize = 0;
      for (const value of ['small', 'medium', 'large']) {
        await changeSize(value);
        await expect(page.locator('.trainee-video-layout')).toHaveClass(
          new RegExp(`coach-video-${value}`),
        );
        const box = await coachTile.boundingBox();
        expect(box).not.toBeNull();
        const dimension = viewport.width <= 600 ? box!.height : box!.width;
        expect(dimension, `${value} changes the coach tile at ${viewport.width}px`).toBeGreaterThan(
          previousSize,
        );
        previousSize = dimension;
        if (value === 'small') {
          expect(Math.abs(box!.width - box!.height)).toBeLessThanOrEqual(1);
          expect(box!.width).toBeGreaterThanOrEqual(104);
          expect(box!.width).toBeLessThanOrEqual(viewport.width <= 950 ? 128 : 184);
          await expectInsideCamera();
          for (const position of ['top-left', 'bottom-left', 'bottom-right', 'top-right']) {
            await page.getByRole('button', { name: 'More options', exact: true }).click();
            await page.getByLabel('Floating coach position').selectOption(position);
            await page.getByRole('button', { name: 'Close dialog' }).click();
            await expect(page.locator('.trainee-video-layout')).toHaveAttribute(
              'data-coach-position',
              position,
            );
            await expectInsideCamera();
            await expectCameraOverlaysAligned();
            await expect(analyzer).toHaveAttribute('data-layout-fixture', fixtureId);
          }
        }
        expect(box!.x).toBeGreaterThanOrEqual(-1);
        expect(box!.y).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
        await expect(analyzer).toHaveAttribute('data-layout-fixture', fixtureId);
        await expect(feed).toHaveAttribute('data-layout-fixture', fixtureId);
        await expectCameraOverlaysAligned();
        if (viewport.width === 1440 || (viewport.width === 3840 && value === 'small')) {
          await mkdir('docs/screenshots', { recursive: true });
          await page.screenshot({
            path: `docs/screenshots/trainee-${viewport.width}-${value}.png`,
          });
        }
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <= window.innerWidth &&
              document.documentElement.scrollHeight <= window.innerHeight,
          ),
        ).toBe(true);
      }
      const cameraBefore = await page.locator('.camera-view').boundingBox();
      await page.getByRole('button', { name: 'Minimize coach video' }).click();
      const restore = page.getByRole('button', { name: 'Restore coach video' });
      await expect(restore).toBeFocused();
      await expect(restore).toHaveAttribute('aria-expanded', 'false');
      await expect(feed).toBeHidden();
      await expect(feed).toHaveAttribute('data-layout-fixture', fixtureId);
      const minimized = await coachTile.boundingBox();
      expect(minimized!.height).toBeLessThanOrEqual(viewport.width >= 2000 ? 64 : 50);
      await expectInsideCamera();
      const cameraAfter = await page.locator('.camera-view').boundingBox();
      if (viewport.width <= 600) expect(cameraAfter!.height).toBeGreaterThan(cameraBefore!.height);
      else expect(cameraAfter!.width).toBeGreaterThan(cameraBefore!.width);
      await restore.press('Enter');
      await expect(page.getByRole('button', { name: 'Minimize coach video' })).toBeFocused();
      await expect(size).toHaveValue('large');
      await expect(feed).toBeVisible();
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await changeSize('small');
    expect(await coachTile.evaluate((element) => getComputedStyle(element).boxShadow)).toBe('none');
    for (const selector of ['.coach-video-toolbar', '.meeting-tile-name', '.analyzer-topbar']) {
      expect(
        await page
          .locator(selector)
          .first()
          .evaluate((element) => getComputedStyle(element).backgroundImage),
      ).toBe('none');
    }
    const cameraBeforeSmallMinimize = await page.locator('.camera-view').boundingBox();
    await page.getByRole('button', { name: 'Minimize coach video' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Restore coach video' })).toBeVisible();
    await expect(feed).toBeHidden();
    await expectInsideCamera();
    const cameraAfterSmallMinimize = await page.locator('.camera-view').boundingBox();
    expect(cameraAfterSmallMinimize!.height).toBe(cameraBeforeSmallMinimize!.height);
    expect(cameraAfterSmallMinimize!.width).toBe(cameraBeforeSmallMinimize!.width);
    const cue = page.locator('.analyzer-cue');
    const cueText = cue.locator('p');
    const fullCue = await cueText.textContent();
    const compactCueBox = await cue.boundingBox();
    const footerBox = await page.locator('.analyzer-footer').boundingBox();
    expect(compactCueBox!.height).toBeLessThanOrEqual(40);
    expect(footerBox!.height).toBeLessThanOrEqual(120);
    const expandCue = page.getByRole('button', { name: 'Expand coaching cue' });
    await expect(expandCue).toHaveAttribute('aria-expanded', 'false');
    await expandCue.click();
    const collapseCue = page.getByRole('button', { name: 'Collapse coaching cue' });
    await expect(collapseCue).toHaveAttribute('aria-expanded', 'true');
    await expect(cueText).toHaveText(fullCue!);
    expect(await cueText.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    await collapseCue.click();
    await expect(expandCue).toHaveAttribute('aria-expanded', 'false');
    expect((await cue.boundingBox())!.height).toBeLessThanOrEqual(40);
    await mkdir('docs/screenshots', { recursive: true });
    await page.screenshot({ path: 'docs/screenshots/compact-trainee-mobile.png' });
    const minimizedAccessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(minimizedAccessibility.violations.map((violation) => violation.id)).toEqual([]);
    await page.getByRole('button', { name: 'Restore coach video' }).click();
    await expect(size).toHaveValue('small');
    await expect(size).toBeHidden();
    await expect(page.getByRole('button', { name: 'Enlarge coach video' })).toBeVisible();
    await expect(feed).toBeVisible();
    await expectInsideCamera();
    await page.screenshot({ path: 'docs/screenshots/floating-coach-mobile.png' });
    const expandedAccessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(expandedAccessibility.violations.map((violation) => violation.id)).toEqual([]);
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
      await coach.close();
    }
  }
});
