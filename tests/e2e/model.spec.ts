import { test, expect, chromium } from '@playwright/test';

for (const failure of [
  'GPU initialization stall',
  'slow Heavy inference',
  'borderline Heavy inference',
  'slow Full inference',
] as const) {
  test(`${failure} recovers without replacing the camera`, async () => {
    test.setTimeout(60000);
    const browser = await chromium.launch({
      channel: 'msedge',
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      const diagnostics = { starts: 0, variant: '', delegate: '' };
      (window as unknown as { recovery: typeof diagnostics }).recovery = diagnostics;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          diagnostics.starts++;
          this.addEventListener('message', ({ data }) => {
            if (data.type === 'ready' || data.type === 'backend') {
              diagnostics.variant = data.variant;
              diagnostics.delegate = data.delegate;
            }
          });
        }
      };
    });
    await page.route('**/pose-worker.js', async (route) => {
      // Retry transient socket resets while the harness loads the worker; assertions still fail normally.
      const response = await route.fetch({ maxRetries: 2 });
      const source = await response.text();
      await route.fulfill({
        response,
        body:
          failure === 'GPU initialization stall'
            ? source
                .replace(
                  'const { FilesetResolver, PoseLandmarker } = self.exports;',
                  `const { FilesetResolver, PoseLandmarker } = self.exports;
                const nativeCreate = PoseLandmarker.createFromOptions.bind(PoseLandmarker);
                PoseLandmarker.createFromOptions = (files, options) =>
                  options.baseOptions.delegate === 'GPU'
                    ? new Promise(() => {})
                    : nativeCreate(files, options);`,
                )
                // Isolate initialization recovery from host CPU speed; the other cases test slow inference.
                .replace('inferenceMs: performance.now() - started,', 'inferenceMs: 1,')
            : source.replace(
                'inferenceMs: performance.now() - started,',
                failure === 'slow Full inference'
                  ? "inferenceMs: variant !== 'lite' ? 150 : performance.now() - started,"
                  : `inferenceMs: variant === 'heavy' ? ${failure === 'borderline Heavy inference' ? 150 : 250} : performance.now() - started,`,
              ),
      });
    });
    try {
      await page.goto('/demo?view=practice');
      await page.getByRole('button', { name: 'Enable camera' }).click();
      await expect
        .poll(() =>
          page.locator('video').evaluate((video) => Boolean((video as HTMLVideoElement).srcObject)),
        )
        .toBe(true);
      await page.evaluate(() => {
        (window as unknown as { originalCamera: MediaStream }).originalCamera =
          document.querySelector('video')!.srcObject as MediaStream;
      });
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (
                  window as unknown as {
                    recovery: { starts: number; variant: string; delegate: string };
                  }
                ).recovery,
            ),
          { timeout: 45000 },
        )
        .toMatchObject(
          failure === 'GPU initialization stall'
            ? { starts: 2, variant: 'heavy', delegate: 'CPU' }
            : {
                variant: failure === 'slow Full inference' ? 'lite' : 'full',
                delegate: expect.stringMatching(/^(GPU|CPU)$/),
              },
        );
      const starts = await page.evaluate(
        () => (window as unknown as { recovery: { starts: number } }).recovery.starts,
      );
      expect(starts).toBeGreaterThanOrEqual(2);
      expect(starts).toBeLessThanOrEqual(failure === 'slow Full inference' ? 4 : 3);
      await expect(
        page.getByText(
          'Step back until your head and required joints fit in view. Use even lighting.',
        ),
      ).toBeVisible();
      expect(
        await page.evaluate(() => {
          const original = (window as unknown as { originalCamera: MediaStream }).originalCamera;
          return (
            original === document.querySelector('video')!.srcObject &&
            original.getVideoTracks().every((track) => track.readyState === 'live')
          );
        }),
      ).toBe(true);
      await expect(page.getByTestId('cumulative-reps')).toHaveText('00');
    } finally {
      await browser.close();
    }
  });
}

for (const [variant, cpuFallback] of [
  ['full', false],
  ['full', true],
  ['heavy', false],
  ['heavy', true],
] as const) {
  test(`real ${variant} pose model loads ${cpuFallback ? 'with CPU fallback' : 'with the available backend'}`, async () => {
    test.setTimeout(60000);
    const browser = await chromium.launch({
      channel: 'msedge',
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.addEventListener('message', ({ data }) => {
            if (data.type === 'ready' || data.type === 'backend') {
              (window as unknown as { poseBackend: unknown }).poseBackend = data;
              const state = window as unknown as { firstPoseVariant?: string };
              state.firstPoseVariant ??= data.variant;
            }
          });
        }
      };
    });
    if (cpuFallback) {
      await page.route('**/pose-worker.js', async (route) => {
        const response = await route.fetch({ maxRetries: 2 });
        // Inject a failed GPU initialization. The fallback then uses the real
        // production model and CPU/WASM initialization without modification.
        await route.fulfill({
          response,
          body: (await response.text()).replace(
            'model = await PoseLandmarker.createFromOptions(files, {',
            "throw new Error('Simulated unavailable GPU delegate');\nmodel = await PoseLandmarker.createFromOptions(files, {",
          ),
        });
      });
    }
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto('http://localhost:3000/demo?view=practice');
      if (variant === 'full') {
        await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
        await page.getByText('Adjust tracking with your coach', { exact: true }).click();
        await page.getByLabel('Tracking quality').selectOption('full');
        await page.getByRole('button', { name: 'Close dialog' }).click();
      }
      await page.getByRole('button', { name: 'Enable camera' }).click();
      await expect(page.getByText('Position camera', { exact: true })).toBeVisible({
        timeout: 45000,
      });
      await expect(
        page.getByText(
          'Step back until your head and required joints fit in view. Use even lighting.',
        ),
      ).toBeVisible({ timeout: 20000 });
      const backend = await page.evaluate(
        () =>
          (window as unknown as { poseBackend: { variant: string; delegate: string } }).poseBackend,
      );
      expect(
        await page.evaluate(
          () => (window as unknown as { firstPoseVariant: string }).firstPoseVariant,
        ),
      ).toBe(variant);
      expect(['heavy', 'full']).toContain(backend.variant);
      expect(
        cpuFallback ? backend.delegate === 'CPU' : ['GPU', 'CPU'].includes(backend.delegate),
      ).toBe(true);
      await page.getByRole('button', { name: 'Stop local camera analysis' }).click();
      await expect(page.getByRole('button', { name: 'Enable camera' })).toBeVisible();
      expect(await page.evaluate(() => document.querySelector('video')?.srcObject === null)).toBe(
        true,
      );
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
}

test('a stalled GPU inference recovers through a real CPU worker without replacing the camera', async () => {
  test.setTimeout(60000);
  const browser = await chromium.launch({
    channel: 'msedge',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const diagnostics = { starts: 0, backend: '' };
    (window as unknown as { poseRecovery: typeof diagnostics }).poseRecovery = diagnostics;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        diagnostics.starts++;
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'ready' || data.type === 'backend') diagnostics.backend = data.delegate;
        });
      }
    };
  });
  await page.route('**/pose-worker.js', async (route) => {
    const response = await route.fetch({ maxRetries: 2 });
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        'const { FilesetResolver, PoseLandmarker } = self.exports;',
        `const { FilesetResolver, PoseLandmarker } = self.exports;
        const nativeCreate = PoseLandmarker.createFromOptions.bind(PoseLandmarker);
        PoseLandmarker.createFromOptions = async (files, options) => {
          if (options.baseOptions.delegate !== 'GPU') return nativeCreate(files, options);
          return { detectForVideo() {
            const started = performance.now();
            while (performance.now() - started < 30000) { /* blocked GPU inference */ }
            return { landmarks: [], worldLandmarks: [] };
          }, close() {} };
        };`,
      ),
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('http://localhost:3000/demo?view=practice');
    await page.getByRole('button', { name: 'Enable camera' }).click();
    await expect(page.getByText('Position camera', { exact: true })).toBeVisible({
      timeout: 45000,
    });
    await page.evaluate(() => {
      (window as unknown as { originalCamera: MediaStream | null }).originalCamera =
        document.querySelector('video')?.srcObject as MediaStream;
    });
    await expect(
      page.getByText(
        'Step back until your head and required joints fit in view. Use even lighting.',
      ),
    ).toBeVisible({ timeout: 20000 });
    const recovery = await page.evaluate(
      () =>
        (window as unknown as { poseRecovery: { starts: number; backend: string } }).poseRecovery,
    );
    expect(recovery.backend).toBe('CPU');
    // After the GPU recovery, slow devices can also step down Heavy → Full → Lite.
    // Those bounded model changes preserve the CPU backend and the camera.
    expect(recovery.starts).toBeGreaterThanOrEqual(2);
    expect(recovery.starts).toBeLessThanOrEqual(4);
    expect(
      await page.evaluate(() => {
        const camera = (window as unknown as { originalCamera: MediaStream }).originalCamera;
        return (
          camera === document.querySelector('video')?.srcObject &&
          camera.getVideoTracks().every((track) => track.readyState === 'live')
        );
      }),
    ).toBe(true);
    await expect(page.getByTestId('cumulative-reps')).toHaveText('00');
    await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
    await page.getByText('Adjust tracking with your coach', { exact: true }).click();
    await expect(page.getByText(/Tracking: (heavy|full|lite) · CPU/)).toBeVisible();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Stop local camera analysis' }).click();
    expect(await page.evaluate(() => document.querySelector('video')?.srcObject)).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});
