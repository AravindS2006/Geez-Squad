import { exerciseIds, getExerciseProfile, type ProfileExerciseId } from './exercise-profiles';

export type ArmMode = 'left' | 'right' | 'both' | 'alternating';
export type MeasurementCapability = 'validated' | 'beta' | 'manual' | 'timed';
export type ExerciseDefinition = {
  id: string;
  name: string;
  group: string;
  equipment: string;
  instructions: string[];
  view: string;
  targetUnit: 'reps' | 'seconds';
  capability: MeasurementCapability;
  profileId: ProfileExerciseId | null;
  modes: ArmMode[];
  color: string;
};
const additions = [
  ['laterallunge', 'Lateral lunge', 'Lower body', 'Bodyweight', false],
  ['stepup', 'Step-up', 'Lower body', 'Stable exercise step', false],
  ['calfraise', 'Calf raise', 'Lower body', 'Bodyweight', false],
  ['wallpushup', 'Wall push-up', 'Upper body', 'Wall', false],
  ['floorpress', 'Dumbbell floor press', 'Upper body', 'Dumbbells and mat', false],
  ['birddog', 'Bird dog', 'Core', 'Exercise mat', false],
  ['deadbug', 'Dead bug', 'Core', 'Exercise mat', false],
  ['mountainclimber', 'Mountain climber', 'Conditioning', 'Exercise mat', false],
  ['catcow', 'Cat–cow', 'Mobility', 'Exercise mat', false],
  ['childspose', 'Child’s pose', 'Mobility', 'Exercise mat', true],
  ['hamstringstretch', 'Standing hamstring stretch', 'Mobility', 'Bodyweight', true],
] as const;
export type AdditionalExerciseId = (typeof additions)[number][0];
export type LibraryExerciseId = ProfileExerciseId | AdditionalExerciseId | `custom:${string}`;
export const armModeLabels: Record<ArmMode, string> = {
  left: 'Left arm',
  right: 'Right arm',
  both: 'Both together',
  alternating: 'Alternating · per arm',
};
export const capabilityLabels: Record<MeasurementCapability, string> = {
  validated: 'Validated automatic',
  beta: 'Automatic beta',
  manual: 'Manual repetitions',
  timed: 'Timed activity',
};
export const exerciseLibrary: ExerciseDefinition[] = [
  ...exerciseIds.map((id): ExerciseDefinition => {
    const p = getExerciseProfile(id);
    return {
      id,
      name: p.name,
      group: p.category,
      equipment:
        p.equipment ??
        (['curl', 'shoulderpress', 'lateralraise', 'row'].includes(id)
          ? 'Optional light dumbbells'
          : 'Bodyweight / exercise mat'),
      instructions: [p.cameraCue, p.startCue, p.moveCue, p.returnCue],
      view: p.cameraCue,
      targetUnit: p.isHold ? 'seconds' : 'reps',
      capability: 'beta',
      profileId: id,
      modes:
        p.limbModes === 'arm'
          ? ['left', 'right', 'both', 'alternating']
          : p.limbModes === 'leg'
            ? ['alternating']
            : [],
      color: p.category === 'Core' ? 'sky' : p.category === 'Lower body' ? 'lime' : 'lavender',
    };
  }),
  ...additions.map(([id, name, group, equipment, timed]): ExerciseDefinition => ({
    id,
    name,
    group,
    equipment,
    targetUnit: timed ? 'seconds' : 'reps',
    capability: timed ? 'timed' : 'manual',
    profileId: null,
    modes: [],
    view: 'Follow your coach’s demonstration. Record your result manually.',
    instructions: [
      'Ask your coach to demonstrate the movement and set your comfortable range.',
      'Move under control and stop if you need a break.',
      'Record the repetitions or observed activity time when you finish.',
    ],
    color:
      group === 'Core' || group === 'Mobility' ? 'sky' : group === 'Lower body' ? 'lime' : 'peach',
  })),
];
export const libraryExerciseIds = exerciseLibrary.map((e) => e.id) as [
  LibraryExerciseId,
  ...LibraryExerciseId[],
];
export const isAutomaticExercise = (id: string): id is ProfileExerciseId =>
  exerciseIds.includes(id as ProfileExerciseId);
export function exerciseDefinition(
  id: string,
  custom: ExerciseDefinition[] = [],
): ExerciseDefinition {
  return (
    exerciseLibrary.find((e) => e.id === id) ??
    custom.find((e) => e.id === id) ?? {
      id,
      name: 'Custom exercise',
      group: 'Coach exercise',
      equipment: 'As instructed',
      instructions: ['Follow your coach’s instructions.'],
      view: 'Manual tracking',
      targetUnit: 'reps',
      capability: 'manual',
      profileId: null,
      modes: [],
      color: 'sky',
    }
  );
}
/** Body part counted by an exercise's left/right modes. */
export function limbNoun(id: string): 'arm' | 'leg' {
  return isAutomaticExercise(id) && getExerciseProfile(id).limbModes === 'leg' ? 'leg' : 'arm';
}
/** Mode label for an exercise; leg exercises say "leg" where curls say "arm". */
export function limbModeLabel(id: string, mode: ArmMode): string {
  return limbNoun(id) === 'leg' ? armModeLabels[mode].replace(/arm/g, 'leg') : armModeLabels[mode];
}
export function usesHoldTime(id: string, custom: ExerciseDefinition[] = []) {
  return exerciseDefinition(id, custom).targetUnit === 'seconds';
}
