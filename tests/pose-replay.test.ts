import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { matchRepEvents, replayPoseReport } from '../src/lib/pose-replay';
import { pilotReleaseGates } from '../src/lib/pilot-evaluation';

describe('local evidence replay', () => {
  it('matches events by side and time without reusing annotations', () => {
    expect(
      matchRepEvents(
        [
          { side: 'left', endedAt: 1000 },
          { side: 'left', endedAt: 1100 },
          { side: 'right', endedAt: 2000 },
        ],
        [
          { side: 'left', endedAt: 1050 },
          { side: 'right', endedAt: 1950 },
        ],
      ),
    ).toMatchObject({ truePositives: 2, falsePositives: 1, falseNegatives: 0 });
  });
  it('does not interpret an empty observation sequence as accuracy evidence', () => {
    expect(replayPoseReport({ frames: [] }).events).toHaveLength(0);
  });
  it('does not approve a perfect but undersized synthetic sample', () => {
    expect(
      pilotReleaseGates([
        {
          participantId: 'p1',
          exercise: 'curl',
          device: 'desktop',
          model: 'full',
          expectedReps: 10,
          observedReps: 10,
          exactCount: true,
          truePositives: 10,
          falsePositives: 0,
          falseNegatives: 0,
          holdErrorMs: null,
        },
      ])[0].releaseReady,
    ).toBe(false);
  });
  it.skipIf(!process.env.GEEZ_POSE_MANIFEST)(
    'evaluates a consented participant-disjoint pilot manifest',
    async () => {
      const manifest = JSON.parse(await readFile(process.env.GEEZ_POSE_MANIFEST!, 'utf8'));
      const tuning = new Set(
        manifest.clips
          .filter((c: { partition: string }) => c.partition === 'tuning')
          .map((c: { participantId: string }) => c.participantId),
      );
      const results = [];
      for (const clip of manifest.clips) {
        expect(clip.consentConfirmed).toBe(true);
        if (clip.partition !== 'evaluation') continue;
        expect(tuning.has(clip.participantId)).toBe(false);
        const report = JSON.parse(await readFile(clip.tracePath, 'utf8'));
        expect(report.frames.length).toBeGreaterThan(0);
        const replay = replayPoseReport(report);
        const mode = report.frames.find((f: { mode: string }) => f.mode === 'active')?.config
          .armMode;
        const events =
          mode === 'left' || mode === 'right'
            ? replay.events.filter((e) => e.side === mode)
            : replay.events;
        results.push({
          participantId: clip.participantId,
          exercise: clip.exercise,
          device: clip.device,
          model: clip.model,
          mode,
          physicalDevice: clip.physicalDevice === true,
          setId: clip.setId,
          ...matchRepEvents(events, clip.repetitions ?? []),
          expectedReps: clip.expectedReps,
          observedReps: replay.reps,
          exactCount: replay.reps === clip.expectedReps,
          holdErrorMs:
            clip.expectedHoldMs == null ? null : Math.abs(replay.holdMs - clip.expectedHoldMs),
        });
      }
      expect(results.length).toBeGreaterThan(0);
      const output = {
        generatedAt: new Date().toISOString(),
        evidence: 'Landmark replay; full video/model and physical-device trials are separate.',
        results,
        groups: pilotReleaseGates(results),
      };
      if (process.env.GEEZ_POSE_REPORT)
        await writeFile(process.env.GEEZ_POSE_REPORT, JSON.stringify(output, null, 2));
    },
  );
});
