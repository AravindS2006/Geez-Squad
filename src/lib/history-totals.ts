import type { WorkoutSetView } from './types';
import { effectiveWorkoutSet, loadVolume, supportsLoadVolume } from './progress-metrics';
export function historyAccumulator(timeZone = 'UTC') {
  const dates = new Set<string>();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  let reps = 0,
    holdMs = 0,
    sets = 0,
    completedSets = 0,
    activeMs = 0,
    trackedMs = 0,
    rejectedReps = 0,
    volume = 0,
    loadedSets = 0;
  const averages = { form: [0, 0], quality: [0, 0], range: [0, 0], tempo: [0, 0] };
  return {
    add(original: WorkoutSetView) {
      const s = effectiveWorkoutSet(original);
      reps += s.reps;
      holdMs += s.holdMs;
      sets++;
      completedSets += Number(s.completed);
      activeMs += s.activeMs;
      trackedMs += s.trackedMs;
      rejectedReps += s.rejectedReps;
      volume += loadVolume(s);
      loadedSets += Number(supportsLoadVolume(s));
      if (s.reps > 0 || s.holdMs > 0) dates.add(formatter.format(new Date(s.endedAt)));
      for (const [key, field, weight] of [
        ['form', 'formScore', s.trackedMs],
        ['quality', 'qualityScore', s.originalReps ?? s.reps],
        ['range', 'rangeDegrees', s.originalReps ?? s.reps],
        ['tempo', 'repSeconds', s.originalReps ?? s.reps],
      ] as const)
        if (s[field] !== null && weight > 0) {
          averages[key][0] += s[field]! * weight;
          averages[key][1] += weight;
        }
    },
    result() {
      const average = (key: keyof typeof averages) =>
        averages[key][1] ? averages[key][0] / averages[key][1] : null;
      return {
        reps,
        holdMs,
        sets,
        completedSets,
        activeMs,
        trackedMs,
        rejectedReps,
        loadVolume: volume,
        loadedSets,
        coverage: activeMs ? (trackedMs / activeMs) * 100 : null,
        trainingDays: dates.size,
        form: average('form'),
        quality: average('quality'),
        range: average('range'),
        tempo: average('tempo'),
      };
    },
  };
}
