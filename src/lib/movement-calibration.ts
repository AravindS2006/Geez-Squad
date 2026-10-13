import type { Analysis } from './pose-engine';
import type { ExerciseId } from './types';
import { getExerciseProfile } from './exercise-profiles';
import { normalizeWorkoutConfig } from './workout-config';

export type MovementCalibration = {
  phase: 'step-back' | 'start' | 'end' | 'complete' | 'failed';
  startedAt: number;
  samples: { at: number; angle: number }[];
  startAngle: number | null;
  side: Analysis['trackedSide'];
  source: Analysis['geometrySource'];
  cue: string;
  range?: { topAngle: number; bottomAngle: number };
};
export function beginMovementCalibration(now: number): MovementCalibration {
  return {
    phase: 'step-back',
    startedAt: now,
    samples: [],
    startAngle: null,
    side: undefined,
    source: undefined,
    cue: 'Step back into camera view. Hold your exercise start position.',
  };
}

// Coach-supervised endpoints are measured from stable, confident observations.
// The window uses timestamps, so changing camera FPS does not change hold time.
export function advanceMovementCalibration(
  current: MovementCalibration,
  analysis: Analysis,
  now: number,
  exercise: ExerciseId,
): MovementCalibration {
  if (current.phase === 'complete' || current.phase === 'failed') return current;
  const profile = getExerciseProfile(exercise);
  if (!Number.isFinite(now) || now < current.startedAt) return current;
  if (now - current.startedAt > 45000 || profile.isHold)
    return {
      ...current,
      phase: 'failed',
      samples: [],
      cue: 'Calibration did not finish. Check camera position and try again with your coach.',
    };
  if (now - current.startedAt < 3000) return current;
  let next = {
    ...current,
    phase: current.phase === 'step-back' ? ('start' as const) : current.phase,
  };
  if (
    !analysis.tracked ||
    analysis.postureValid === false ||
    analysis.confidence < 0.8 ||
    analysis.angle === null ||
    !Number.isFinite(analysis.angle) ||
    (analysis.score !== null && analysis.score < 70)
  )
    return {
      ...next,
      samples: [],
      cue: 'Keep the required joints visible in good lighting. Follow your coach’s camera position.',
    };
  if (
    next.side !== undefined &&
    (next.side !== analysis.trackedSide || next.source !== analysis.geometrySource)
  )
    return {
      ...next,
      phase: 'failed',
      samples: [],
      cue: 'The tracked side or depth geometry changed. Select one body side and calibrate again.',
    };
  next.side = analysis.trackedSide;
  next.source = analysis.geometrySource;
  const last = next.samples.at(-1);
  if (last && (now <= last.at || now - last.at > 500)) next.samples = [];
  const angle = analysis.angle;
  const moved =
    next.startAngle !== null &&
    (profile.direction === 'decrease' ? next.startAngle - angle : angle - next.startAngle) >= 25;
  if (next.phase === 'end' && !moved)
    return {
      ...next,
      samples: [],
      cue: `${profile.moveCue} Hold your comfortable end position for two seconds. Only use a range your coach approves.`,
    };
  const samples = [...next.samples.filter((sample) => now - sample.at <= 1500), { at: now, angle }];
  const angles = samples.map((sample) => sample.angle).sort((a, b) => a - b);
  if (angles.at(-1)! - angles[0] > 6)
    return {
      ...next,
      samples: [{ at: now, angle }],
      cue:
        next.phase === 'start'
          ? `${profile.startCue} Hold still for two seconds.`
          : 'Hold your comfortable end position for two seconds.',
    };
  next.samples = samples;
  if (samples.length < 6 || now - samples[0].at < 1200) return next;
  const measured = angles[Math.floor(angles.length / 2)];
  if (next.phase === 'start')
    return {
      ...next,
      phase: 'end',
      startAngle: measured,
      samples: [],
      cue: `${profile.moveCue} Hold your comfortable end position for two seconds.`,
    };
  const high = Math.max(next.startAngle!, measured),
    low = Math.min(next.startAngle!, measured);
  const inset = Math.min(4, Math.max(0, (high - low - 25) / 2));
  const range = normalizeWorkoutConfig(exercise, {
    topAngle: high - inset,
    bottomAngle: low + inset,
  });
  if (range.topAngle > high || range.bottomAngle < low || range.topAngle - range.bottomAngle < 25)
    return {
      ...next,
      phase: 'failed',
      samples: [],
      cue: 'This range cannot be measured reliably. Ask your coach to adjust the endpoints in workout settings.',
    };
  return {
    ...next,
    phase: 'complete',
    samples: [],
    range: { topAngle: range.topAngle, bottomAngle: range.bottomAngle },
    cue: 'Your measured range is saved. Return to start, then tap Start set when ready.',
  };
}
