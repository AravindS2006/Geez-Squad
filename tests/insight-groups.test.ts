import { describe, expect, it } from 'vitest';
import {
  groupExerciseBreakdown,
  ruleVersionNumber,
  showsRepTempo,
} from '../src/lib/progress-metrics';

const row = (exercise: string, version: string, reps: number, sets = 1, completedSets = 1) => ({
  exercise,
  version,
  summary: { reps, holdMs: 0, sets, completedSets },
});

describe('insight exercise groups', () => {
  it('orders rule versions numerically, not as text', () => {
    expect(ruleVersionNumber('profile-v10')).toBeGreaterThan(ruleVersionNumber('profile-v9'));
    expect(ruleVersionNumber('legacy')).toBe(0);
  });
  it('keeps the tempo display for every rule version from v8 onwards', () => {
    expect(['profile-v7', 'profile-v8', 'profile-v9', 'manual'].map(showsRepTempo)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
  it('shows one entry per exercise, summing counts and keeping measurements per version', () => {
    const groups = groupExerciseBreakdown([
      row('squat', 'profile-v8', 20, 2, 1),
      row('curl', 'profile-v9', 5),
      row('squat', 'profile-v10', 12, 1, 1),
      row('squat', 'profile-v9', 8, 1, 0),
    ]);
    expect(groups.map((group) => group.exercise)).toEqual(['squat', 'curl']);
    const squat = groups[0];
    expect(squat).toMatchObject({ reps: 40, sets: 4, completedSets: 2 });
    expect(squat.current.version).toBe('profile-v10');
    expect(squat.earlier.map((entry) => entry.version)).toEqual(['profile-v9', 'profile-v8']);
    // The newest version keeps its own measurement, unblended with older versions.
    expect(squat.current.summary.reps).toBe(12);
  });
});
