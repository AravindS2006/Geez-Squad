import { test, expect } from '@playwright/test';
import { addPoseFixture, moveThroughAngles } from './support/pose-fixture';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

test('tracking and counts continue when Safari-style video callbacks never arrive', async ({
  page,
}) => {
  await addPoseFixture(page);
  await page.addInitScript(() => {
    HTMLVideoElement.prototype.requestVideoFrameCallback = () => 1;
    HTMLVideoElement.prototype.cancelVideoFrameCallback = () => {};
  });
  await page.goto('/demo?view=practice');
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.getByText('Pose detected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start set', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause set', exact: true })).toBeVisible({
    timeout: 15000,
  });
  await moveThroughAngles(page, [165, 150, 135, 120, 105, 95]);
  await page.waitForTimeout(350);
  await moveThroughAngles(page, [105, 120, 135, 150, 165, 180]);
  await expect(page.getByTestId('cumulative-reps')).toHaveText('01');
  const stream = await page
    .locator('video.camera-video')
    .evaluate((video) => (video as HTMLVideoElement).srcObject);
  expect(stream).not.toBeNull();
  await page.locator('video.camera-video').evaluate((video) => (video as HTMLVideoElement).pause());
  await expect(page.getByRole('button', { name: 'Resume camera', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume camera', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('cumulative-reps')).toHaveText('01');
});

test('failed video ImageBitmap capture recovers through the real canvas/model path', async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const capture = window.createImageBitmap.bind(window);
    window.createImageBitmap = ((source: ImageBitmapSource, ...args: unknown[]) => {
      if (source instanceof HTMLVideoElement)
        return Promise.reject(new TypeError('Video bitmap capture unavailable'));
      return (capture as (...input: unknown[]) => Promise<ImageBitmap>)(source, ...args);
    }) as typeof createImageBitmap;
  });
  await page.goto('/demo?view=practice');
  await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
  await page.getByText('Adjust tracking with your coach', { exact: true }).click();
  await page.getByLabel('Tracking quality').selectOption('full');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.locator('[data-camera-status]')).toHaveAttribute(
    'data-pose-runtime',
    'browser',
    { timeout: 45000 },
  );
  await expect
    .poll(async () =>
      Number(await page.locator('[data-tracking-fps]').getAttribute('data-tracking-fps')),
    )
    .toBeGreaterThan(0);
  await expect(page.getByTestId('cumulative-reps')).toHaveText('00');
  await page.getByRole('button', { name: 'Stop local camera analysis', exact: true }).click();
  expect(
    await page
      .locator('video.camera-video')
      .evaluate((video) => (video as HTMLVideoElement).srcObject),
  ).toBeNull();
  expect(errors).toEqual([]);
});
