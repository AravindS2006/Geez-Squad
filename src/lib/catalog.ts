import { exerciseLibrary } from './exercise-library';
export const exercises = exerciseLibrary;
export function exerciseName(id: string) {
  return exercises.find((e) => e.id === id)?.name ?? 'Custom exercise';
}
export const starterBlocks = [
  { id: 'foundation-squat', exercise: 'squat' as const, sets: 3, reps: 12, rest: 60 },
  { id: 'foundation-pushup', exercise: 'pushup' as const, sets: 3, reps: 10, rest: 60 },
  { id: 'foundation-plank', exercise: 'plank' as const, sets: 3, reps: 30, rest: 45 },
];
