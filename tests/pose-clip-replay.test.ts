import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { replayPoseReport } from '../src/lib/pose-replay';
import { RULE_VERSION } from '../src/lib/pose-engine';

type Clip = {
  id: string;
  exercise: string;
  expectedReps: number | null;
  expectedHoldMs: number | null;
  tracePath: string;
};

// Driven by scripts/pose-clip-check.mjs. Internet clips are a smoke check of the
// model-to-count path: they are not consented, annotated or physical-device evidence.
describe('video clip replay', () => {
  it.skipIf(!process.env.GEEZ_CLIP_MANIFEST)(
    'replays model landmarks from local clips through the counting engine',
    async () => {
      const manifest = JSON.parse(await readFile(process.env.GEEZ_CLIP_MANIFEST!, 'utf8')) as {
        clips: Clip[];
      };
      const clips = [];
      for (const clip of manifest.clips) {
        const trace = JSON.parse(await readFile(clip.tracePath, 'utf8'));
        expect(trace.frames.length, `${clip.id} has no frames`).toBeGreaterThan(0);
        // --no-depth answers "what would image-plane geometry alone have counted?".
        if (process.env.GEEZ_CLIP_NO_DEPTH) for (const frame of trace.frames) frame.worldPoses = [];
        const replay = replayPoseReport(trace);
        const tracked = replay.frames.filter((frame) => frame.tracked);
        const angles = tracked.flatMap((frame) => (frame.angle === null ? [] : [frame.angle]));
        const cues = new Map<string, number>();
        for (const frame of replay.frames)
          if (!frame.tracked) cues.set(frame.cue, (cues.get(frame.cue) ?? 0) + 1);
        const rejections = new Map<string, number>();
        let previous: string | null = null;
        for (const frame of replay.frames) {
          // A rejection stays on screen for many frames; count each one once.
          if (frame.rejection && frame.rejection !== previous)
            rejections.set(frame.rejection, (rejections.get(frame.rejection) ?? 0) + 1);
          previous = frame.rejection;
        }
        const hold = clip.expectedHoldMs !== null;
        const expected = hold ? clip.expectedHoldMs : clip.expectedReps;
        const counted = hold ? replay.holdMs : replay.reps;
        clips.push({
          id: clip.id,
          exercise: clip.exercise,
          expected: expected === null ? '—' : hold ? `${Math.round(expected / 1000)}s` : expected,
          counted: hold ? `${Math.round(counted / 1000)}s` : counted,
          result:
            expected === null
              ? 'unlabelled'
              : (hold ? Math.abs(counted - expected) <= 1000 : counted === expected)
                ? 'match'
                : 'mismatch',
          trackedShare: tracked.length / replay.frames.length,
          angleRange: angles.length ? `${Math.min(...angles)}–${Math.max(...angles)}°` : '—',
          rejections:
            [...rejections].map(([reason, count]) => `${reason}×${count}`).join(' ') || '—',
          topUntrackedCue: [...cues].sort((a, b) => b[1] - a[1])[0]?.[0].slice(0, 60) ?? '—',
          arms: replay.arms
            ? { left: replay.arms.left.reps, right: replay.arms.right.reps }
            : undefined,
          events: replay.events.map((event) => ({
            side: event.side,
            endedAt: event.endedAt,
            rangeDegrees: event.rangeDegrees,
            observedMs: event.observedMs,
          })),
          // One line per frame for diagnosis: time, angle, tracked, reps and cue.
          timeline: replay.frames.map(
            (frame) =>
              `${frame.timestamp} ${frame.angle ?? '-'} ${frame.tracked ? 'T' : 'x'} ${frame.reps} ${frame.rejection ?? ''} | ${frame.cue}`,
          ),
        });
      }
      if (process.env.GEEZ_CLIP_REPORT)
        await writeFile(
          process.env.GEEZ_CLIP_REPORT,
          JSON.stringify(
            { generatedAt: new Date().toISOString(), ruleVersion: RULE_VERSION, clips },
            null,
            2,
          ),
        );
    },
  );
});
