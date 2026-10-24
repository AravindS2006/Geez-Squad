import { z } from 'zod';
const optionalNumber = (max: number) => z.number().finite().min(0).max(max).nullable();
export const nutritionProfileSchema = z.object({
  calories: optionalNumber(20000).refine((n) => n === null || Number.isInteger(n)),
  protein: optionalNumber(1000),
  waterMl: optionalNumber(20000).refine((n) => n === null || Number.isInteger(n)),
  preferences: z.string().trim().max(1000),
  guidance: z.string().trim().max(2000),
});
export const nutritionEntrySchema = z.object({
  id: z.uuid(),
  date: z.iso.date(),
  meal: z.enum(['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Water']),
  description: z.string().trim().min(1).max(500),
  calories: optionalNumber(20000).refine((n) => n === null || Number.isInteger(n)),
  protein: optionalNumber(1000),
  carbs: optionalNumber(2000),
  fat: optionalNumber(1000),
  waterMl: z.number().int().min(0).max(20000),
});
export const nutritionCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('entry'), entry: nutritionEntrySchema }),
  z.object({ action: z.literal('remove'), id: z.uuid() }),
  z.object({ action: z.literal('sharing'), shareWithCoach: z.boolean() }),
  z.object({
    action: z.literal('targets'),
    userId: z.string().min(1).max(100),
    profile: nutritionProfileSchema,
  }),
]);
export type NutritionProfile = z.infer<typeof nutritionProfileSchema> & {
  shareWithCoach: boolean;
  updatedAt?: string;
  updatedById?: string;
};
export type NutritionEntry = z.infer<typeof nutritionEntrySchema>;
export type NutritionData = {
  profile: NutritionProfile;
  entries: NutritionEntry[];
  canEditJournal: boolean;
};
export const emptyNutritionProfile: NutritionProfile = {
  shareWithCoach: false,
  calories: null,
  protein: null,
  waterMl: null,
  preferences: '',
  guidance: '',
};
export function nutritionTotals(entries: NutritionEntry[]) {
  const total = (key: 'calories' | 'protein' | 'carbs' | 'fat') => {
    const values = entries.map((e) => e[key]).filter((v): v is number => v !== null);
    return {
      value: Math.round(values.reduce((sum, n) => sum + n, 0) * 10) / 10,
      known: values.length,
      total: entries.length,
    };
  };
  return {
    calories: total('calories'),
    protein: total('protein'),
    carbs: total('carbs'),
    fat: total('fat'),
    waterMl: entries.reduce((s, e) => s + e.waterMl, 0),
  };
}
