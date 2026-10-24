import { z } from 'zod';
import {
  libraryExerciseIds,
  usesHoldTime,
  isAutomaticExercise,
  type LibraryExerciseId,
} from './exercise-library';
import { measurementSchema } from './measurement-contract';
import { MAX_CLASS_CLIENTS } from './class-policy';
export const exerciseSchema = z
  .union([z.enum(libraryExerciseIds), z.string().regex(/^custom:[a-zA-Z0-9-]{1,80}$/)])
  .transform((id) => id as LibraryExerciseId);
const identifier = z.string().min(1).max(100);
const block = z.object({
  id: identifier.optional(),
  exercise: exerciseSchema,
  sets: z.number().int().min(1).max(10),
  reps: z.number().int().min(1).max(120),
  rest: z.number().int().min(0).max(300),
  loadKg: z.number().finite().min(0).max(500).optional(),
  loadBasis: z.enum(['per-hand', 'total']).optional(),
  armMode: z.enum(['left', 'right', 'both', 'alternating']).optional(),
  targetUnit: z.enum(['reps', 'seconds']).optional(),
});
export const commandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('onboard'),
    role: z.literal('trainee'),
    name: z.string().trim().min(2).max(80),
    studioName: z.string().trim().max(80).optional(),
    adult: z.literal(true),
  }),
  z.object({
    action: z.literal('invite'),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
  }),
  z.object({ action: z.literal('acceptInvite'), code: z.string().min(16).max(120) }),
  z.object({
    action: z.literal('savePlan'),
    id: identifier.optional(),
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(400),
    blocks: z.array(block).min(1).max(20),
  }),
  z.object({ action: z.literal('deletePlan'), id: identifier }),
  z.object({ action: z.literal('assignPlan'), userId: identifier, planId: identifier.nullable() }),
  z.object({
    action: z.literal('coachNote'),
    userId: identifier,
    note: z.string().trim().max(2000),
  }),
  z.object({
    action: z.literal('checkIn'),
    energy: z.number().int().min(1).max(5),
    soreness: z.number().int().min(0).max(5),
    effort: z.number().int().min(1).max(10).nullable(),
    sleepHours: z.number().finite().min(0).max(24).nullable(),
    bodyweightKg: z.number().finite().min(20).max(500).nullable(),
    note: z.string().trim().max(600),
  }),
  z.object({
    action: z.literal('createClass'),
    hostId: identifier.optional(),
    title: z.string().trim().min(2).max(80),
    startsAt: z.iso.datetime(),
    duration: z.number().int().min(10).max(120),
    capacity: z.number().int().min(1).max(MAX_CLASS_CLIENTS),
    planId: identifier.optional(),
    participantIds: z.array(identifier).max(MAX_CLASS_CLIENTS),
    includeAllClients: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('updateClass'),
    hostId: identifier.optional(),
    id: identifier,
    expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string().trim().min(2).max(80),
    startsAt: z.iso.datetime(),
    duration: z.number().int().min(10).max(120),
    capacity: z.number().int().min(1).max(MAX_CLASS_CLIENTS),
    planId: identifier.nullable(),
    participantIds: z.array(identifier).max(MAX_CLASS_CLIENTS),
    includeAllClients: z.boolean().default(false),
  }),
  z
    .object({
      action: z.literal('clientProfile'),
      userId: identifier,
      name: z.string().trim().min(2).max(80),
      goal: z.string().trim().min(2).max(160),
      expectedName: z.string().max(80),
      expectedGoal: z.string().max(160),
    })
    .strict(),
  z.object({ action: z.literal('removeClient'), userId: identifier }).strict(),
  z.object({
    action: z.literal('classControl'),
    id: identifier,
    control: z.enum(['start', 'pause', 'resume', 'end', 'cancel', 'exercise']),
    exercise: exerciseSchema.optional(),
    blockId: identifier.optional(),
  }),
  z.object({ action: z.literal('consent'), id: identifier, consent: z.literal(true) }),
  z.object({
    action: z.literal('muteParticipants'),
    id: identifier,
    participantId: identifier.optional(),
  }),
  z.object({
    action: z.literal('help'),
    id: identifier,
    requested: z.boolean(),
    userId: identifier.optional(),
  }),
  z.object({
    action: z.literal('message'),
    id: identifier,
    text: z.string().trim().min(1).max(600),
    recipientId: identifier.optional(),
    kind: z.enum(['chat', 'cue']).default('chat'),
  }),
  z.object({
    action: z.literal('profile'),
    name: z.string().trim().min(2).max(80),
    goal: z.string().trim().min(2).max(160),
  }),
]);
export const metricSchema = z
  .object({
    ...measurementSchema.shape,
    classId: identifier,
    exercise: exerciseSchema,
    revision: z.number().int().min(0),
    reps: z.number().int().min(0).max(5000),
    holdSeconds: z.number().int().min(0).max(7200),
    score: z.number().finite().min(0).max(100).nullable(),
    confidence: z.number().finite().min(0).max(1),
    phase: z.string().max(40),
    cue: z.string().max(180),
    quality: z.number().finite().min(0).max(100).nullable().optional(),
    rangeDegrees: z.number().finite().min(0).max(180).nullable().optional(),
    repSeconds: z.number().finite().min(0).max(30).nullable().optional(),
    trackingCoverage: z.number().finite().min(0).max(100).nullable().optional(),
    rejectedReps: z.number().int().min(0).max(5000).optional(),
  })
  .refine(
    (data) =>
      data.targetUnit === 'seconds' || usesHoldTime(data.exercise)
        ? data.reps === 0
        : data.holdSeconds === 0,
    {
      message: 'Use repetitions or hold time for the selected exercise.',
    },
  );
const score = z.number().finite().min(0).max(100).nullable();
export const workoutSetSchema = z
  .object({
    ...measurementSchema.shape,
    clientId: z.uuid(),
    ownerId: identifier.optional(),
    classId: identifier.nullable(),
    revision: z.number().int().min(0),
    exercise: exerciseSchema,
    ruleVersion: z.string().min(1).max(40),
    setNumber: z.number().int().min(1).max(10),
    target: z.number().int().min(1).max(120),
    reps: z.number().int().min(0).max(500),
    holdMs: z.number().int().min(0).max(7200000),
    activeMs: z.number().int().min(0).max(7200000),
    trackedMs: z.number().int().min(0).max(7200000),
    formScore: score,
    qualityScore: score,
    rangeDegrees: z.number().finite().min(0).max(180).nullable(),
    repSeconds: z.number().finite().min(0).max(30).nullable(),
    confidence: z.number().finite().min(0).max(1).nullable(),
    rejectedReps: z.number().int().min(0).max(5000),
    loadKg: z.number().finite().min(0).max(500).nullable(),
    completed: z.boolean(),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const wallMs = Date.parse(data.endedAt) - Date.parse(data.startedAt);
    if (
      wallMs < 0 ||
      data.activeMs > wallMs + 1000 ||
      data.trackedMs > data.activeMs ||
      ((data.measurementSource ?? 'automatic') === 'automatic'
        ? data.holdMs > data.trackedMs
        : data.holdMs > data.activeMs) ||
      data.reps > Math.max(1, Math.ceil(data.activeMs / 350))
    )
      ctx.addIssue({ code: 'custom', message: 'Workout timing and counts are inconsistent.' });
    if (data.measurementSource === 'automatic' && !isAutomaticExercise(data.exercise))
      ctx.addIssue({ code: 'custom', message: 'This exercise requires manual tracking.' });
    if (data.armMode && data.exercise !== 'curl')
      ctx.addIssue({ code: 'custom', message: 'This exercise does not support arm modes.' });
    if (data.armMode && data.arms) {
      const a = data.arms;
      const expected =
        data.armMode === 'left'
          ? a.left.reps
          : data.armMode === 'right'
            ? a.right.reps
            : Math.min(a.left.reps, a.right.reps);
      if (data.armMode === 'both' ? data.reps > expected : data.reps !== expected)
        ctx.addIssue({ code: 'custom', message: 'Arm counts do not match the selected mode.' });
    }
  });
