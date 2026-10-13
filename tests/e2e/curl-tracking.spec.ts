import { chromium, expect, test } from '@playwright/test';

type CurlFixture = {
  curlStartedAt: number | null;
  curlDurationMs: number;
  curlWorkerVariants: string[];
  curlOverlaySamples: { raw: number; drawn: number }[];
  curlRawWristX: number;
  curlObservedCounts: string[];
  curlTerminatedWorkers: number;
  curlArmLean: number;
};

for (const condition of [
  { name: 'phone with a steady starting arm', noisy: false, viewport: { width: 390, height: 844 } },
  {
    name: 'phone with idle-arm jitter and torso identity errors',
    noisy: true,
    viewport: { width: 390, height: 844 },
  },
  {
    name: 'desktop with a steady starting arm',
    noisy: false,
    viewport: { width: 1280, height: 720 },
  },
  {
    name: 'desktop with idle-arm jitter and torso identity errors',
    noisy: true,
    viewport: { width: 1280, height: 720 },
  },
])
  test(`front-facing ${condition.name} counts ten continuous curls and detects depth form errors`, async ({}, testInfo) => {
    test.setTimeout(60000);
    const browser = await chromium.launch({
      channel: 'msedge',
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    });
    const context = await browser.newContext({ viewport: condition.viewport });
    const page = await context.newPage();
    // The worker fixture emits MediaPipe's image and world-landmark contracts.
    // The production geometry, automatic limb selection, filtering and rep engine run unchanged.
    await page.addInitScript(({ noisy }) => {
      const fixture = window as unknown as CurlFixture;
      fixture.curlStartedAt = null;
      fixture.curlDurationMs = 1200;
      fixture.curlWorkerVariants = [];
      fixture.curlOverlaySamples = [];
      fixture.curlRawWristX = 0.695;
      fixture.curlObservedCounts = [];
      fixture.curlTerminatedWorkers = 0;
      fixture.curlArmLean = 0;
      const drawLine = CanvasRenderingContext2D.prototype.lineTo;
      CanvasRenderingContext2D.prototype.lineTo = function (x: number, y: number) {
        if (
          this.canvas.classList.contains('pose-canvas') &&
          Math.abs(y / this.canvas.height - 0.56) < 0.005 &&
          x / this.canvas.width > 0.65 &&
          x / this.canvas.width < 0.75
        ) {
          fixture.curlOverlaySamples.push({
            raw: fixture.curlRawWristX,
            drawn: x / this.canvas.width,
          });
        }
        return drawLine.call(this, x, y);
      };
      class CurlWorkerFixture {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror = null;
        frame = 0;
        postMessage(data: {
          type: string;
          variant?: string;
          bitmap?: ImageBitmap;
          timestamp?: number;
          width?: number;
          height?: number;
        }) {
          if (data.type === 'init') {
            fixture.curlWorkerVariants.push(data.variant ?? 'full');
            setTimeout(
              () =>
                this.onmessage?.({
                  data: { type: 'ready', variant: data.variant, delegate: 'CPU' },
                }),
              20,
            );
            return;
          }
          this.frame++;
          const elapsed =
            fixture.curlStartedAt === null
              ? 0
              : Math.max(0, data.timestamp! - fixture.curlStartedAt);
          const moving = fixture.curlStartedAt !== null && elapsed < 10 * fixture.curlDurationMs;
          const rightAngle = moving
            ? 120 + 50 * Math.cos((elapsed / fixture.curlDurationMs) * Math.PI * 2)
            : 170;
          const image = Array.from({ length: 33 }, () => ({
            x: 0.5,
            y: 0.5,
            visibility: 0.95,
            presence: 0.95,
          }));
          const world = image.map((point) => ({ ...point, z: 0 }));
          for (const side of [0, 1]) {
            const x = side === 0 ? 0.3 : 0.7;
            const worldX = side === 0 ? -0.15 : 0.15;
            const angle = side === 0 ? (moving && noisy ? 142 : 170) : rightAngle;
            const lean = (fixture.curlArmLean * Math.PI) / 180;
            const radians = ((angle - fixture.curlArmLean) * Math.PI) / 180;
            image[11 + side] = { x, y: 0.2, visibility: 0.95, presence: 0.95 };
            image[13 + side] = { x, y: 0.42, visibility: 0.95, presence: 0.95 };
            image[23 + side] = { x, y: 0.65, visibility: 0.95, presence: 0.95 };
            image[25 + side] = { x, y: 0.77, visibility: 0.95, presence: 0.95 };
            image[27 + side] = { x, y: 0.92, visibility: 0.95, presence: 0.95 };
            // Both projected arms remain almost straight; the right wrist's slight
            // alternating camera jitter must be filtered for the drawn skeleton.
            image[15 + side] = {
              x: x + (side === 0 ? 0.005 : -0.005 + (this.frame % 2 ? 0.003 : -0.003)),
              y: 0.56,
              visibility: 0.95,
              presence: 0.95,
            };
            world[11 + side] = {
              x: worldX,
              y: -0.45,
              z: 0,
              visibility: 0.95,
              presence: 0.95,
            };
            world[13 + side] = {
              x: worldX,
              y: -0.45 + 0.22 * Math.cos(lean),
              z: -0.22 * Math.sin(lean),
              visibility: 0.95,
              presence: 0.95,
            };
            world[23 + side] = {
              x: worldX,
              y: 0,
              z: 0,
              visibility: 0.95,
              presence: 0.95,
            };
            world[15 + side] = {
              x: worldX,
              y: world[13 + side].y - Math.cos(radians) * 0.18,
              z: world[13 + side].z - Math.sin(radians) * 0.18,
              visibility: 0.95,
              presence: 0.95,
            };
          }
          // Contradictory torso labels are model errors, not physical movement.
          // Current image/world measurements must be rejected together without
          // splicing a different arm into the observed cycle.
          if (moving && noisy && this.frame % 17 === 0) {
            const index = this.frame % 34 === 0 ? 11 : 23;
            [image[index], image[index + 1]] = [image[index + 1], image[index]];
            [world[index], world[index + 1]] = [world[index + 1], world[index]];
          }
          fixture.curlRawWristX = image[16].x;
          data.bitmap?.close();
          setTimeout(
            () =>
              this.onmessage?.({
                data: {
                  type: 'result',
                  poses: [image],
                  worldPoses: [world],
                  timestamp: data.timestamp,
                  width: data.width,
                  height: data.height,
                },
              }),
            10,
          );
        }
        terminate() {
          this.onmessage = null;
          fixture.curlTerminatedWorkers++;
        }
      }
      window.Worker = CurlWorkerFixture as unknown as typeof Worker;
    }, condition);
    try {
      await page.goto(
        `${process.env.GEEZ_SQUAD_VERIFY_URL || 'http://localhost:3000'}/demo?view=practice`,
      );
      await page.getByLabel('Exercise to practice').selectOption('curl');
      await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
      await expect(page.getByLabel('Reps per set')).toHaveValue('12');
      await page.locator('details.tracking-settings > summary').click();
      await expect(page.getByLabel('Tracking quality')).toHaveValue('heavy');
      await expect(page.getByLabel('Body side')).toHaveValue('auto');
      if (condition.noisy)
        await page.getByRole('checkbox', { name: 'Record tracking report locally' }).check();
      await page.getByRole('button', { name: 'Close dialog' }).click();
      await page.getByRole('button', { name: 'Enable camera' }).click();
      await expect(page.getByText('Pose detected', { exact: true })).toBeVisible();
      const reps = page.getByTestId('cumulative-reps');
      await expect(reps).toHaveText('00');
      await page.getByRole('button', { name: 'Start set', exact: true }).click();
      await expect(page.getByLabel('Set start countdown')).toContainText('5');
      await expect(page.getByRole('button', { name: 'Pause set', exact: true })).toBeVisible();
      await expect(reps).toHaveText('00');
      await reps.evaluate((node) => {
        const fixture = window as unknown as CurlFixture;
        fixture.curlObservedCounts = [node.textContent ?? ''];
        const observer = new MutationObserver(() => {
          const value = node.textContent ?? '';
          if (fixture.curlObservedCounts.at(-1) !== value) fixture.curlObservedCounts.push(value);
        });
        observer.observe(node, { childList: true, subtree: true, characterData: true });
        fixture.curlStartedAt = performance.now();
      });
      try {
        await expect(reps).toHaveText('10', { timeout: 17000 });
      } catch (error) {
        if (condition.noisy) {
          await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
          const tracking = page.locator('details.tracking-settings');
          if (!(await tracking.evaluate((node) => (node as HTMLDetailsElement).open)))
            await tracking.locator('summary').click();
          const downloaded = page.waitForEvent('download');
          await page.getByRole('button', { name: 'Download tracking report' }).click();
          await (await downloaded).saveAs(testInfo.outputPath('tracking-report.json'));
        }
        throw error;
      }
      await page.waitForTimeout(2500);
      await expect(reps).toHaveText('10');
      const fixture = await page.evaluate(() => {
        const current = window as unknown as CurlFixture;
        return {
          counts: current.curlObservedCounts,
          variants: current.curlWorkerVariants,
          overlayFrames: current.curlOverlaySamples.length,
          filteredFrames: current.curlOverlaySamples.filter(
            (sample) => Math.abs(sample.raw - sample.drawn) > 0.0001,
          ).length,
          rawJitter: current.curlOverlaySamples
            .slice(-200)
            .reduce((sum, sample) => sum + Math.abs(sample.raw - 0.695), 0),
          drawnJitter: current.curlOverlaySamples
            .slice(-200)
            .reduce((sum, sample) => sum + Math.abs(sample.drawn - 0.695), 0),
        };
      });
      expect(fixture.counts).toEqual(
        Array.from({ length: 11 }, (_, index) => String(index).padStart(2, '0')),
      );
      expect(fixture.variants).toEqual(['heavy']);
      expect(fixture.overlayFrames).toBeGreaterThan(50);
      // Display smoothing reduces visible camera jitter; counting uses the original
      // measurements and still observes all ten complete movements.
      expect(fixture.filteredFrames).toBeGreaterThan(50);
      expect(fixture.drawnJitter).toBeLessThan(fixture.rawJitter * 0.8);
      await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
      const details = page.locator('.movement-metrics');
      await expect(
        details.locator('span').filter({ hasText: 'Tracked side:' }).locator('b'),
      ).toHaveText('right');
      const quality = await details
        .locator('span')
        .filter({ hasText: 'Last rep quality:' })
        .locator('b')
        .textContent();
      expect(Number.parseInt(quality ?? '', 10)).toBeGreaterThanOrEqual(85);
      const range = await details
        .locator('span')
        .filter({ hasText: 'Last rep range:' })
        .locator('b')
        .textContent();
      expect(Number.parseInt(range ?? '', 10)).toBeGreaterThanOrEqual(65);
      if (condition.noisy) {
        const tracking = page.locator('details.tracking-settings');
        if (!(await tracking.evaluate((node) => (node as HTMLDetailsElement).open)))
          await tracking.locator('summary').click();
        const downloaded = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download tracking report' }).click();
        const download = await downloaded;
        expect(download.suggestedFilename()).toBe('geez-squad-tracking-report.json');
        const stream = await download.createReadStream();
        const chunks: Buffer[] = [];
        for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
        const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        expect(report.frameCount).toBeGreaterThan(30);
        expect(report.frameCount).toBeLessThanOrEqual(600);
        expect(report.ruleVersion).toBe('profile-v7');
        expect(
          report.frames.some(
            (frame: { continuity: string }) => frame.continuity === 'landmark-identity',
          ),
        ).toBe(true);
        expect(report.frames.at(-1).analysis.reps).toBe(10);
        expect(report.frames.every((frame: { poses: unknown[] }) => frame.poses.length === 1)).toBe(
          true,
        );
        expect(JSON.stringify(report)).not.toMatch(/bitmap|data:image|apiKey|cookie/);
      }
      await page.getByRole('button', { name: 'Close dialog' }).click();
      await page.evaluate(() => {
        (window as unknown as CurlFixture).curlArmLean = 50;
      });
      await expect
        .poll(async () =>
          Number.parseInt(
            await page.locator('.analyzer-hud > div').nth(1).locator('strong').innerText(),
            10,
          ),
        )
        .toBeLessThan(75);
      await expect(page.locator('.analyzer-cue')).toContainText('upper arm');
      await expect(reps).toHaveText('10');
      await page.getByRole('button', { name: 'Stop local camera analysis' }).click();
      await expect(page.getByRole('button', { name: 'Enable camera' })).toBeVisible();
      expect(
        await page.evaluate(() => (window as unknown as CurlFixture).curlTerminatedWorkers),
      ).toBe(1);
    } finally {
      await browser.close();
    }
  });
