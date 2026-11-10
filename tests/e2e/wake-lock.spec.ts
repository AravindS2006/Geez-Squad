import { test, expect, type Page } from '@playwright/test';
import { addPoseFixture } from './support/pose-fixture';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

type WakeLockEvidence = { requests: number; held: number; hide: () => void; show: () => void };
const evidence = (page: Page) =>
  page.evaluate(() => {
    const { requests, held } = (window as unknown as { wakeLockEvidence: WakeLockEvidence })
      .wakeLockEvidence;
    return { requests, held };
  });

// The headless browser has no screen to keep awake, so the API is replaced by a counter.
// This proves when the page asks for and gives up the lock, not that a phone stays on.
test('camera analysis holds the screen wake lock and gives it up when stopped', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await addPoseFixture(page);
  await page.addInitScript(() => {
    let hidden = false;
    let dropCurrent: (() => void) | null = null;
    const state: WakeLockEvidence = {
      requests: 0,
      held: 0,
      hide() {
        hidden = true;
        dropCurrent?.();
        document.dispatchEvent(new Event('visibilitychange'));
      },
      show() {
        hidden = false;
        document.dispatchEvent(new Event('visibilitychange'));
      },
    };
    (window as unknown as { wakeLockEvidence: WakeLockEvidence }).wakeLockEvidence = state;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async (type: string) => {
          if (type !== 'screen') throw new TypeError('Unexpected wake lock type');
          state.requests++;
          state.held++;
          let listener: () => void = () => {};
          let released = false;
          const drop = () => {
            if (released) return;
            released = true;
            state.held--;
            if (dropCurrent === drop) dropCurrent = null;
            listener();
          };
          dropCurrent = drop;
          return {
            release: async () => drop(),
            addEventListener: (_type: string, callback: () => void) => {
              listener = callback;
            },
          };
        },
      },
    });
  });
  await page.goto('/demo?view=practice');
  await expect(page.getByRole('button', { name: 'Enable camera', exact: true })).toBeVisible();
  expect(await evidence(page)).toEqual({ requests: 0, held: 0 });

  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.getByText('Pose detected', { exact: true })).toBeVisible();
  expect(await evidence(page)).toEqual({ requests: 1, held: 1 });

  // The browser drops the lock while hidden; returning to the page must ask again.
  await page.evaluate(() =>
    (window as unknown as { wakeLockEvidence: WakeLockEvidence }).wakeLockEvidence.hide(),
  );
  expect(await evidence(page)).toEqual({ requests: 1, held: 0 });
  await page.evaluate(() =>
    (window as unknown as { wakeLockEvidence: WakeLockEvidence }).wakeLockEvidence.show(),
  );
  await expect.poll(() => evidence(page)).toEqual({ requests: 2, held: 1 });

  await page.getByRole('button', { name: 'Stop local camera analysis' }).click();
  await expect(page.getByRole('button', { name: 'Enable camera', exact: true })).toBeVisible();
  await expect.poll(() => evidence(page)).toEqual({ requests: 2, held: 0 });
  expect(errors).toEqual([]);
});
