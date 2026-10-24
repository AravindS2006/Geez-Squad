import { test, expect } from '@playwright/test';
test('sample studio supports navigation, plan edits, scheduling, and an isolated live preview', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'A stronger studio starts here.' })).toBeVisible();
  await expect(
    page.getByText('All client data and history are illustrative.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Workout plans' }).click();
  await page.getByRole('button', { name: 'Create plan', exact: true }).click();
  await page.getByLabel('Plan name').fill('Controlled strength');
  await page.getByLabel('A little context').fill('Test plan in sample mode.');
  await page.getByRole('button', { name: 'Save workout plan' }).click();
  await expect(page.getByRole('heading', { name: 'Controlled strength' })).toBeVisible();
  await page.getByRole('link', { name: 'Live sessions', exact: true }).click();
  await page.getByRole('button', { name: 'Schedule session', exact: true }).click();
  await page.getByLabel('Session title').fill('Mindful movement');
  await page
    .getByRole('dialog')
    .getByRole('checkbox', { name: /Ava Thompson/ })
    .check();
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Include all clients' }).check();
  await expect(
    page.getByRole('dialog').getByRole('checkbox', { name: /Ava Thompson/ }),
  ).toBeEnabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Schedule session' }).click();
  await expect(page.getByText('Mindful movement', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Coaching overview', exact: true }).click();
  await page
    .getByRole('button', { name: /^(Open studio|Join session)$/ })
    .first()
    .click();
  await expect(page.getByText('ILLUSTRATIVE STUDIO PREVIEW')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Focus Ava Thompson/ })).toBeVisible();
  await page.getByRole('button', { name: 'Coach tools', exact: true }).click();
  await page.getByLabel('Coaching cue', { exact: true }).fill('Move under control.');
  await page.getByRole('button', { name: 'Send class cue' }).click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByText('Move under control.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Pause class' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('mobile navigation closes with its close button, backdrop, Escape, and Settings', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'A stronger studio starts here.' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    JSON.stringify(
      await page.evaluate(() =>
        Array.from(document.querySelectorAll('main *'))
          .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 12)
          .map((e) => ({
            tag: e.tagName,
            cls: e.className,
            width: e.getBoundingClientRect().width,
          })),
      ),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('dialog', { name: 'Workspace navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Close navigation' }).click();
  await expect(page.getByRole('dialog', { name: 'Workspace navigation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('button', { name: 'Dismiss navigation' })
    .click({ position: { x: 340, y: 100 } });
  await expect(page.getByRole('dialog', { name: 'Workspace navigation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Workspace navigation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: /Coaching clients/ }).click();
  await expect(page.getByRole('heading', { name: 'People make the progress.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('workout settings teach the selected movement and persist without opening the camera', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo?view=practice');
  await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Workout settings' })).toBeVisible();
  await expect(
    page
      .getByRole('dialog')
      .getByText('Stand tall with your feet about shoulder-width apart.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Sets', { exact: true }).fill('2');
  await page.getByLabel('Reps per set').fill('8');
  await page.getByLabel('Rest (seconds)').fill('30');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Workout settings' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start set', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.querySelector('video')?.srcObject === null)).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
  await expect(page.getByLabel('Sets', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('Reps per set')).toHaveValue('8');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Workout settings' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Workout settings', exact: true })).toBeFocused();
  await page.getByLabel('Exercise to practice').selectOption('plank');
  await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
  await expect(page.getByLabel('Seconds per set')).toHaveValue('30');
  await expect(
    page
      .getByRole('region', { name: 'How to do this exercise' })
      .getByText('Hold a side-on plank with shoulders, hips, and ankles aligned.', {
        exact: true,
      }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('Exercise to practice').selectOption('sideplank');
  await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
  await expect(page.getByLabel('Seconds per set')).toHaveValue('30');
  await expect(
    page
      .getByRole('region', { name: 'How to do this exercise' })
      .getByText('Keep hips lifted and breathe comfortably.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 },
]) {
  test(`coach keeps every trainee on screen while selecting and coaching at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/demo?view=studio');
    const traineeNames = ['Ava Thompson', 'Leo Martinez', 'Mia Chen', 'Noah Williams'];
    const tiles = traineeNames.map((name) =>
      page.getByRole('button', { name: new RegExp(`^Focus ${name}`) }),
    );
    async function expectGalleryFits() {
      for (const tile of tiles) {
        await expect(tile).toBeVisible();
        const box = await tile.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(-1);
        expect(box!.y).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const dock = await page.locator('.meeting-dock').boundingBox();
      expect(dock).not.toBeNull();
      expect(dock!.y + dock!.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    await expectGalleryFits();
    await tiles[0].click();
    await expect(tiles[0]).toHaveAttribute('aria-pressed', 'true');
    await expectGalleryFits();
    await page.getByRole('button', { name: 'Coach tools', exact: true }).click();
    await expect(page.getByLabel('Coaching cue', { exact: true })).toBeVisible();
    await expectGalleryFits();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(page.getByLabel('Coaching cue', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Coach tools', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Session conversation' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Session conversation' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeFocused();
    await expectGalleryFits();
    await expect(page.locator('.meeting-room .exercise-art')).toHaveCount(0);
  });
}
test('camera practice starts only after consented user action and handles denial', async ({
  page,
  context,
}) => {
  await context.grantPermissions([]);
  await page.goto('/demo?view=practice');
  await expect(page.getByRole('button', { name: 'Enable camera' })).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('video')?.srcObject === null)).toBe(true);
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Enable camera' })).toBeVisible();
});
