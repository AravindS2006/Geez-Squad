import { chromium, expect, test } from '@playwright/test';
import { addPoseFixture, changePose, type PoseFixture } from './support/pose-fixture';

test('a cropped joint preserves visible body points, gives framing instructions, and cannot start or count a set', async () => {
  const browser = await chromium.launch({
    channel: 'msedge',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await addPoseFixture(page);
  try {
    await page.goto(
      `${process.env.GEEZ_SQUAD_VERIFY_URL || 'http://localhost:3000'}/demo?view=practice`,
    );
    await page.getByRole('button', { name: 'Enable camera' }).click();
    await expect(page.getByText('Pose detected', { exact: true })).toBeVisible();
    await changePose(page, { poseAnkleConfidence: 0.1 });
    await expect(page.getByText('Position camera', { exact: true })).toBeVisible();
    await expect(page.locator('.analyzer-cue')).toContainText('ankle');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as PoseFixture).drawnPoseJoints))
      .toBe(20);
    await expect(page.getByTestId('cumulative-reps')).toHaveText('00');
    await page.getByRole('button', { name: 'Start set', exact: true }).click();
    await expect(page.locator('.analyzer-cue')).toContainText('lighting');
    await expect(page.getByLabel('Set start countdown')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Pause set', exact: true })).toBeHidden();
    await changePose(page, { poseAngle: 95 });
    await page.waitForTimeout(600);
    await changePose(page, { poseAngle: 180 });
    await page.waitForTimeout(600);
    await expect(page.getByTestId('cumulative-reps')).toHaveText('00');
    await changePose(page, { poseVisible: false });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as PoseFixture).drawnPoseJoints))
      .toBe(0);
    await changePose(page, { poseVisible: true, poseAnkleConfidence: 0.95 });
    await expect(page.getByLabel('Set start countdown')).toContainText('5');
    await page.getByRole('button', { name: 'Cancel start', exact: true }).click();
    await page.getByRole('button', { name: 'Stop local camera analysis' }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as PoseFixture).drawnPoseJoints))
      .toBe(0);
  } finally {
    await browser.close();
  }
});
