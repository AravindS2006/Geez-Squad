import 'server-only';
import { db } from './db';
import { ApiError } from './security';
import { exerciseLibrary, type ExerciseDefinition } from './exercise-library';
import type { Block } from './types';
export function customDefinition(e: {
  id: string;
  name: string;
  equipment: string;
  instructions: string;
  targetUnit: string;
}): ExerciseDefinition {
  return {
    id: e.id,
    name: e.name,
    equipment: e.equipment,
    instructions: e.instructions.split('\n').filter(Boolean),
    targetUnit: e.targetUnit === 'seconds' ? 'seconds' : 'reps',
    group: 'Coach exercise',
    view: 'Follow your coach’s instructions. Manual tracking.',
    profileId: null,
    capability: e.targetUnit === 'seconds' ? 'timed' : 'manual',
    modes: [],
    color: 'sky',
  };
}
export async function requireExercise(id: string, studioId: string | null | undefined) {
  const builtIn = exerciseLibrary.find((e) => e.id === id);
  if (builtIn) return builtIn;
  const custom = studioId ? await db.customExercise.findFirst({ where: { id, studioId } }) : null;
  if (!custom) throw new ApiError(404, 'This exercise is not available in your studio.');
  return customDefinition(custom);
}
export async function validateBlocks(blocks: Block[], studioId: string): Promise<Block[]> {
  const definitions = await Promise.all(blocks.map((b) => requireExercise(b.exercise, studioId)));
  const ids = new Set<string>();
  return blocks.map((block, i) => {
    const definition = definitions[i];
    if (block.armMode && !definition.modes.includes(block.armMode))
      throw new ApiError(400, 'Unsupported exercise mode.');
    const id = block.id ?? crypto.randomUUID();
    if (ids.has(id)) throw new ApiError(400, 'Each workout block needs its own identity.');
    ids.add(id);
    return { ...block, id, targetUnit: definition.targetUnit };
  });
}
