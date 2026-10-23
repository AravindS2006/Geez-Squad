import { describe, expect, it } from 'vitest';
import { setFeedback, workoutFeedback } from '../src/lib/workout-feedback';
describe('set completion feedback', () => {
  it('distinguishes target completion, early finishes, and timed holds', () => {
    expect(setFeedback(1, 12, 12, false)).toBe('Set 1 complete · 12/12 reps');
    expect(setFeedback(1, 8, 12, false)).toBe('Set 1 finished early · 8/12 reps');
    expect(setFeedback(2, 0, 30, true)).toBe('Set 2 finished early · 0/30 seconds');
    expect(setFeedback(2, 30, 30, true)).toBe('Set 2 complete · 30/30 seconds');
  });
  it('does not describe an early final finish as successful completion', () => {
    expect(workoutFeedback([true, false, true])).toBe('Workout finished · 2 of 3 targets reached');
    expect(workoutFeedback([true, true])).toBe('Workout complete');
  });
});
