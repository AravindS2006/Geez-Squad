import { z } from 'zod';
const arm = z
  .object({
    reps: z.number().int().min(0).max(5000),
    rangeDegrees: z.number().finite().min(0).max(180).nullable(),
    repSeconds: z.number().finite().min(0).max(30).nullable(),
    trackedMs: z.number().finite().min(0).max(7200000).transform(Math.round),
    activeMs: z.number().finite().min(0).max(7200000).transform(Math.round),
  })
  .strict()
  .refine((a) => a.trackedMs <= a.activeMs, 'Tracked arm time exceeds observed time.');
export const measurementSchema = z.object({
  exerciseLabel: z.string().trim().min(1).max(80).optional(),
  schemaVersion: z.literal(2).optional(),
  runId: z.string().max(100).nullable().optional(),
  blockId: z.string().max(100).nullable().optional(),
  armMode: z.enum(['left', 'right', 'both', 'alternating']).nullable().optional(),
  arms: z.object({ left: arm, right: arm }).strict().nullable().optional(),
  measurementSource: z.enum(['automatic', 'manual', 'timer']).optional(),
  targetUnit: z.enum(['reps', 'seconds']).optional(),
  loadBasis: z.enum(['per-hand', 'total']).nullable().optional(),
  technique: z.enum(['steady', 'adjust', 'uncertain']).nullable().optional(),
});
export type Measurement = z.infer<typeof measurementSchema>;
export function measurementData(value: unknown): Measurement {
  const parsed = measurementSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
export function splitMeasurement<T extends object>(record: T) {
  const data = { ...record } as Record<string, unknown>;
  const measurement: Record<string, unknown> = {};
  for (const key of Object.keys(measurementSchema.shape)) {
    if (data[key] !== undefined) measurement[key] = data[key];
    delete data[key];
  }
  return { data, measurement };
}
