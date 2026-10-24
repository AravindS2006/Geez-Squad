import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { addPoseFixture } from './support/pose-fixture';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

async function insideViewport(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  return box!;
}

test('practice uses the viewport and keeps the camera alive through guide and layout changes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await addPoseFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/demo?view=practice');
  await expect(page.getByRole('button', { name: 'Enable camera', exact: true })).toBeVisible();
  const offCamera = await insideViewport(page, '.camera-view');
  expect(offCamera.width).toBeGreaterThan(1300);
  expect(offCamera.height).toBeGreaterThan(540);
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.getByText('Pose detected', { exact: true })).toBeVisible();
  const stream = await page
    .locator('video.camera-video')
    .evaluate(
      (video) =>
        (video as HTMLVideoElement).srcObject &&
        ((video as HTMLVideoElement).srcObject as MediaStream).id,
    );
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 644, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await insideViewport(page, 'select[aria-label="Exercise to practice"]');
    await insideViewport(page, '.camera-view');
    await insideViewport(page, '.analyzer-footer');
    await page.getByRole('button', { name: 'Movement guide', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Movement guide' })).toBeVisible();
    await page.getByRole('button', { name: 'Close movement guide' }).click();
    expect(
      await page
        .locator('video.camera-video')
        .evaluate((video) => ((video as HTMLVideoElement).srcObject as MediaStream)?.id),
    ).toBe(stream);
    const a11y = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      a11y.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
    await mkdir('docs/screenshots', { recursive: true });
    await page.screenshot({ path: `docs/screenshots/practice-workspace-${viewport.width}.png` });
  }
  expect(errors).toEqual([]);
});

test('cancelling pending camera permission stops a late grant and permits a clean retry', async ({
  page,
}) => {
  await addPoseFixture(page);
  await page.addInitScript(() => {
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const state = window as unknown as { releaseCamera: () => void; lateCameraStopped: boolean };
    let first = true;
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (!first) return getMedia(constraints);
      first = false;
      return new Promise((resolve) => {
        state.releaseCamera = async () => {
          const stream = await getMedia(constraints);
          resolve(stream);
          setTimeout(() => {
            state.lateCameraStopped = stream.getTracks().every((t) => t.readyState === 'ended');
          }, 50);
        };
      });
    };
  });
  await page.goto('/demo?view=practice');
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.getByText('Allow camera access in your browser to continue.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel camera setup' }).click();
  await page.evaluate(() => (window as unknown as { releaseCamera: () => void }).releaseCamera());
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { lateCameraStopped: boolean }).lateCameraStopped),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.getByText('Pose detected', { exact: true })).toBeVisible();
});

test('permission denial gives visible guidance and manual tracking remains usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Fixture denial', 'NotAllowedError');
    };
  });
  await page.goto('/demo?view=practice');
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.locator('.camera-access-error[role="alert"]')).toContainText(
    'Camera permission was denied',
  );
  await insideViewport(page, '.camera-access-error');
  await page.getByRole('button', { name: 'Use manual tracking', exact: true }).click();
  await page.getByRole('button', { name: 'Start set', exact: true }).click();
  await expect(page.getByLabel('Manual repetitions')).toBeVisible();
});

test('coach gallery enlarges feeds and keeps floating controls in view', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/demo?view=sessions');
  await page.getByRole('button', { name: 'Open studio', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Class video gallery' })).toBeVisible();
  const start = page.getByRole('button', { name: 'Start class', exact: true });
  if (await start.count()) await start.click();
  await expect(page.getByRole('button', { name: 'Pause class', exact: true })).toBeVisible();
  // Layout stress fixture matching the extra action rendered after a LiveKit join.
  // It exercises wrapping; it does not claim a real external video-room connection.
  await page.locator('.meeting-session-buttons').evaluate((group) => {
    const leave = document.createElement('button');
    leave.className = 'button meeting-leave';
    leave.setAttribute('aria-label', 'Leave video');
    leave.innerHTML =
      '<span class="meeting-full-label">Leave video</span><span class="meeting-mobile-label" aria-hidden="true">Leave</span>';
    const icon = group.querySelector('.meeting-end svg')?.cloneNode(true);
    if (icon) leave.prepend(icon);
    group.prepend(leave);
  });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 644, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.monitor-gallery .meeting-tile')).toHaveCount(4);
    const feed = await page.locator('.participant-feed').first().boundingBox();
    expect(feed!.height).toBeGreaterThan(
      viewport.width <= 360 ? 200 : viewport.width < 760 ? 260 : 300,
    );
    await insideViewport(page, '.meeting-dock');
    const buttons = await page.locator('.meeting-dock button').all();
    for (const button of buttons) {
      if (!(await button.isVisible())) continue;
      const b = (await button.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(viewport.width);
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    const back = (await page
      .getByRole('button', { name: 'Back to sessions', exact: true })
      .boundingBox())!;
    const workout = (await page
      .getByRole('button', { name: 'Workout queue', exact: true })
      .boundingBox())!;
    expect(workout.x).toBeGreaterThan(back.x + back.width);
    await page.getByRole('button', { name: 'Workout queue', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Class workout sequence' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: 'Class workout sequence' })).toBeHidden();
    const a11y = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      a11y.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
    await mkdir('docs/screenshots', { recursive: true });
    await page.screenshot({ path: `docs/screenshots/meeting-workspace-${viewport.width}.png` });
  }
  expect(errors).toEqual([]);
});
