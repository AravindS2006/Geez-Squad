import { test, expect, chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { matchRepEvents } from '../../src/lib/pose-replay';

for (const variant of ['heavy', 'full', 'lite']) {
  test(`consented annotated video through the real ${variant} worker`, async () => {
    test.skip(
      !process.env.GEEZ_POSE_VIDEO || !process.env.GEEZ_POSE_ANNOTATIONS,
      'Requires local consented Y4M footage and manually annotated movement intervals.',
    );
    test.setTimeout(180000);
    const annotation = JSON.parse(await readFile(process.env.GEEZ_POSE_ANNOTATIONS!, 'utf8'));
    expect(annotation.consentConfirmed).toBe(true);
    expect(annotation.durationMs).toBeGreaterThan(0);
    const browser = await chromium.launch({
      channel: 'msedge',
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-video-capture=${resolve(process.env.GEEZ_POSE_VIDEO!)}`,
      ],
    });
    try {
      const page = await browser.newPage();
      await page.goto('http://localhost:3000/demo?view=practice');
      await page.getByLabel('Exercise to practice').selectOption(annotation.exercise);
      if (annotation.exercise === 'curl')
        await page.getByLabel('Curl workout mode').selectOption(annotation.armMode);
      await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
      await page.getByLabel('Reps per set').fill('120');
      await page.locator('details.tracking-settings > summary').click();
      await page.getByLabel('Tracking quality').selectOption(variant);
      await page.getByRole('checkbox', { name: 'Record tracking report locally' }).check();
      await page.getByRole('button', { name: 'Close dialog' }).click();
      await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
      await expect(page.getByText('Pose detected', { exact: true })).toBeVisible({
        timeout: 60000,
      });
      await page.getByRole('button', { name: 'Start set', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Pause set', exact: true })).toBeVisible({
        timeout: 45000,
      });
      await page.waitForTimeout(Math.min(25000, annotation.observeMs ?? 20000));
      await page.getByRole('button', { name: 'Workout settings', exact: true }).click();
      await page.locator('details.tracking-settings').evaluate((element) => {
        (element as HTMLDetailsElement).open = true;
      });
      const downloaded = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download tracking report' }).click();
      const download = await downloaded,
        chunks: Buffer[] = [];
      for await (const chunk of (await download.createReadStream())!)
        chunks.push(Buffer.from(chunk));
      const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const frames = report.frames.filter(
        (f: { mode: string; mediaTimeMs?: number }) =>
          f.mode === 'active' && Number.isFinite(f.mediaTimeMs),
      );
      expect(frames.length).toBeGreaterThan(20);
      const first = frames[0],
        last = frames.at(-1);
      const mediaTime = (timestamp: number) => {
        const closest = frames.reduce((a: { timestamp: number }, b: { timestamp: number }) =>
          Math.abs(b.timestamp - timestamp) < Math.abs(a.timestamp - timestamp) ? b : a,
        );
        return closest.mediaTimeMs + timestamp - closest.timestamp;
      };
      const truth = [];
      for (
        let repeat = 0;
        repeat <= Math.ceil(last.mediaTimeMs / annotation.durationMs);
        repeat++
      ) {
        for (const rep of annotation.repetitions) {
          const startedAt = rep.startedAt + repeat * annotation.durationMs,
            endedAt = rep.endedAt + repeat * annotation.durationMs;
          if (startedAt >= first.mediaTimeMs && endedAt <= last.mediaTimeMs)
            truth.push({ ...rep, startedAt, endedAt });
        }
      }
      expect(
        truth.length,
        'The observed window must contain manually labeled complete movements.',
      ).toBeGreaterThan(0);
      const detected = frames
        .flatMap(
          (f: {
            analysis: {
              repEvents?: { id: string; startedAt: number; endedAt: number; side: string }[];
            };
          }) => f.analysis.repEvents ?? [],
        )
        .filter((e: { startedAt: number }) => mediaTime(e.startedAt) >= first.mediaTimeMs)
        .map((e: { endedAt: number; side: string }) => ({ ...e, endedAt: mediaTime(e.endedAt) }));
      const events =
        annotation.armMode === 'left' || annotation.armMode === 'right'
          ? detected.filter((e: { side: string }) => e.side === annotation.armMode)
          : detected;
      const accuracy = matchRepEvents(events, truth);
      await mkdir('test-results/pose-benchmarks', { recursive: true });
      await writeFile(
        `test-results/pose-benchmarks/${variant}.json`,
        JSON.stringify(
          {
            variant,
            participantId: annotation.participantId,
            device: annotation.device,
            source: 'Real video, capture, pinned model, and worker; simulated camera transport.',
            accuracy,
            report,
          },
          null,
          2,
        ),
      );
      expect(accuracy.precision).toBeGreaterThanOrEqual(0.99);
      expect(accuracy.recall).toBeGreaterThanOrEqual(0.97);
    } finally {
      await browser.close();
    }
  });
}
