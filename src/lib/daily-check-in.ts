import { z } from 'zod';
import { studioToday } from './studio-operations';

/** "HH:MM" on a 24-hour clock, used for the time sliders. */
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * Lifestyle answers about the previous day. Each yes/no question is null when the trainee
 * skipped it. Follow-up values only count when their question is answered "yes".
 */
export const checkInJournalSchema = z
  .object({
    sunlight: z.boolean().nullable(),
    sunlightMinutes: z.number().int().min(1).max(240).nullable(),
    sunlightAt: clockTime.nullable(),
    stress: z.boolean().nullable(),
    alcohol: z.boolean().nullable(),
    alcoholDrinks: z.number().int().min(1).max(20).nullable(),
    caffeine: z.boolean().nullable(),
    caffeineServings: z.number().int().min(1).max(20).nullable(),
    caffeineLastAt: clockTime.nullable(),
    hydrated: z.boolean().nullable(),
  })
  .strict();
export type CheckInJournal = z.infer<typeof checkInJournalSchema>;

export const emptyJournal: CheckInJournal = {
  sunlight: null,
  sunlightMinutes: null,
  sunlightAt: null,
  stress: null,
  alcohol: null,
  alcoholDrinks: null,
  caffeine: null,
  caffeineServings: null,
  caffeineLastAt: null,
  hydrated: null,
};

/** Clears follow-up values whose question was not answered "yes". */
export function normalizeJournal(journal: CheckInJournal): CheckInJournal {
  return {
    ...journal,
    sunlightMinutes: journal.sunlight ? journal.sunlightMinutes : null,
    sunlightAt: journal.sunlight ? journal.sunlightAt : null,
    alcoholDrinks: journal.alcohol ? journal.alcoholDrinks : null,
    caffeineServings: journal.caffeine ? journal.caffeineServings : null,
    caffeineLastAt: journal.caffeine ? journal.caffeineLastAt : null,
  };
}

/** True when the trainee answered nothing, so no journal needs storing. */
export function isEmptyJournal(journal: CheckInJournal) {
  return Object.values(journal).every((value) => value === null);
}

/** Reads a stored journal. Older check-ins have none; unreadable values read as none. */
export function parseJournal(value: unknown): CheckInJournal | null {
  const parsed = checkInJournalSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Minutes after midnight to "HH:MM". */
export function clockLabel(minutes: number) {
  const bounded = Math.min(Math.max(Math.round(minutes), 0), 23 * 60 + 59);
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`;
}

/** "HH:MM" to minutes after midnight. */
export function clockMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** One short line for check-in history, or '' when nothing was answered. */
export function journalSummary(journal: CheckInJournal | null | undefined) {
  if (!journal) return '';
  const parts: string[] = [];
  if (journal.sunlight === true)
    parts.push(
      [
        'Morning sunlight',
        journal.sunlightMinutes && `${journal.sunlightMinutes} min`,
        journal.sunlightAt && `at ${journal.sunlightAt}`,
      ]
        .filter(Boolean)
        .join(' '),
    );
  if (journal.sunlight === false) parts.push('No morning sunlight');
  if (journal.stress !== null) parts.push(journal.stress ? 'Stressed' : 'No stress');
  if (journal.alcohol === true)
    parts.push(journal.alcoholDrinks ? `Alcohol ${journal.alcoholDrinks}` : 'Alcohol');
  if (journal.alcohol === false) parts.push('No alcohol');
  if (journal.caffeine === true)
    parts.push(
      [
        'Caffeine',
        journal.caffeineServings && `${journal.caffeineServings}`,
        journal.caffeineLastAt && `last at ${journal.caffeineLastAt}`,
      ]
        .filter(Boolean)
        .join(' '),
    );
  if (journal.caffeine === false) parts.push('No caffeine');
  if (journal.hydrated !== null) parts.push(journal.hydrated ? 'Hydrated' : 'Not hydrated');
  return parts.join(' · ');
}

/**
 * Whether the daily check-in should open by itself: on Home, for a trainee who has not checked
 * in yet this studio day (India time). `skippedDay` is a per-device opt-out the app never
 * writes itself (e2e specs that are not about the check-in seed it).
 */
export function shouldOpenDailyCheckIn({
  userId,
  checkIns,
  skippedDay,
  now = new Date(),
}: {
  userId: string;
  checkIns: { userId: string; createdAt: string }[];
  skippedDay: string | null;
  now?: Date;
}) {
  const today = studioToday(now);
  if (skippedDay === today) return false;
  return !checkIns.some(
    (entry) => entry.userId === userId && studioToday(new Date(entry.createdAt)) === today,
  );
}

/**
 * localStorage key for the per-device opt-out above. A new name, so the old "shown today"
 * marker (written whenever the dialog opened) no longer hides it from people who never saved.
 */
export const dailyCheckInSkipKey = (userId: string) => `geez-squad:daily-check-in-skip:${userId}`;
