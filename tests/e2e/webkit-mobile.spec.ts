import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addPublicPoseCamera } from './support/public-pose-camera';

test('iPhone install suggestion cannot obstruct navigation and core workspace pages fit', async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/demo');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.app-install')).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.locator('.app-install')).toBeHidden();
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Workspace navigation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss install suggestion', exact: true }).click();
  await page.waitForLoadState('networkidle');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.app-install')).toHaveCount(0);
  for (const view of [
    'nutrition',
    'members',
    'memberships',
    'attendance',
    'payments',
    'enquiries',
    'staff',
    'classes',
    'studio-details',
    'coaching',
    'clients',
    'sessions',
    'plans',
    'analytics',
    'settings',
  ]) {
    await page.goto('/demo?view=' + view);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      view,
    ).toBe(true);
  }
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('iPhone compatibility path draws real model landmarks without worker graphics or video bitmaps', async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await addPublicPoseCamera(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'OffscreenCanvas', { value: undefined, configurable: true });
    window.createImageBitmap = (() =>
      Promise.reject(new Error('Video ImageBitmap unavailable'))) as typeof createImageBitmap;
    window.Worker = class {
      constructor() {
        throw new Error('iPhone camera must use compatibility runtime');
      }
    } as unknown as typeof Worker;
  });
  await page.goto('/demo?view=practice');
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.locator('[data-camera-status]')).toHaveAttribute(
    'data-camera-status',
    'ready',
    { timeout: 60000 },
  );
  await expect(page.locator('[data-pose-runtime]')).toHaveAttribute('data-pose-runtime', 'browser');
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { drawnPoseJoints: number }).drawnPoseJoints),
      { timeout: 30000 },
    )
    .toBeGreaterThan(10);
  await expect
    .poll(async () =>
      Number(await page.locator('[data-tracking-fps]').getAttribute('data-tracking-fps')),
    )
    .toBeGreaterThan(0);
  await expect(page.getByTestId('cumulative-reps')).toHaveText('00');
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Movement guide', exact: true }).click();
    await page.getByRole('button', { name: 'Close movement guide' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.locator('video.camera-video').evaluate((video) => (video as HTMLVideoElement).pause());
  await page.getByRole('button', { name: 'Resume camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume camera', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop local camera analysis', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { testCameraStopped: boolean }).testCameraStopped,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('iPhone practice and meeting controls remain usable with manual fallback', async ({
  page,
}) => {
  await page.goto('/demo?view=practice');
  await page.getByRole('button', { name: 'Use manual tracking', exact: true }).click();
  await page.getByRole('button', { name: 'Start set', exact: true }).click();
  await expect(page.getByLabel('Manual repetitions')).toBeVisible();
  await page.getByLabel('Manual repetitions').fill('3');
  const a11y = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    a11y.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  ).toEqual([]);
  await page.getByRole('link', { name: 'Back to workspace', exact: true }).click();
  await expect(page).not.toHaveURL(/view=practice/);
  await page.goto('/demo?view=sessions');
  await page.getByRole('button', { name: 'Open studio', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Class video gallery' })).toBeVisible();
  await page.getByRole('button', { name: 'Workout queue', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Class workout sequence' })).toBeVisible();
  await page.getByRole('button', { name: 'Close workout queue' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations.map((v) => v.id),
  ).toEqual([]);
});
