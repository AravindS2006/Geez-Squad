import type { CheckInView } from './types';
import type { CheckInJournal } from './daily-check-in';
import { addDays, studioToday } from './studio-operations';

/** How far back the coach register reaches, in studio days. */
export const REGISTER_DAYS = 30;

/**
 * The register date from a query value: today when empty, otherwise a real YYYY-MM-DD within
 * the last REGISTER_DAYS studio days. Null when it is not one.
 */
export function registerDate(value: string | null, now = new Date()): string | null {
  const today = studioToday(now);
  const date = value || today;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    return null;
  if (date > today || date < addDays(today, -REGISTER_DAYS)) return null;
  return date;
}

/** One studio day (Asia/Kolkata, UTC+05:30 all year) as a half-open instant range. */
export function studioDayRange(date: string) {
  const start = new Date(`${date}T00:00:00+05:30`);
  return { start, end: new Date(start.getTime() + 86400000) };
}

export type RegisterRow = {
  userId: string;
  name: string;
  /** That day's check-ins, newest first. Empty when the trainee has not checked in. */
  checkIns: CheckInView[];
};

/** One row per trainee, A to Z, with the check-ins they shared on `date`. */
export function registerRows(
  trainees: { id: string; name: string }[],
  checkIns: CheckInView[],
  date: string,
): RegisterRow[] {
  return trainees
    .map((trainee) => ({
      userId: trainee.id,
      name: trainee.name,
      checkIns: checkIns
        .filter(
          (entry) => entry.userId === trainee.id && studioToday(new Date(entry.createdAt)) === date,
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function registerSummary(rows: RegisterRow[]) {
  return { checkedIn: rows.filter((row) => row.checkIns.length).length, total: rows.length };
}

const NONE = '—';
function answer(value: boolean | null | undefined, ...details: unknown[]) {
  if (value === null || value === undefined) return NONE;
  if (!value) return 'No';
  return ['Yes', ...details.filter((d): d is string => typeof d === 'string' && !!d)].join(' · ');
}
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** One display value per journal question: "Yes · details", "No", or "—" when skipped. */
export function journalCells(journal: CheckInJournal | null | undefined) {
  const j = journal;
  return {
    sunlight: answer(
      j?.sunlight,
      j?.sunlightMinutes && `${j.sunlightMinutes} min`,
      j?.sunlightAt && `at ${j.sunlightAt}`,
    ),
    stress: answer(j?.stress),
    alcohol: answer(j?.alcohol, j?.alcoholDrinks && plural(j.alcoholDrinks, 'drink')),
    caffeine: answer(
      j?.caffeine,
      j?.caffeineServings && plural(j.caffeineServings, 'serving'),
      j?.caffeineLastAt && `last ${j.caffeineLastAt}`,
    ),
    hydrated: answer(j?.hydrated),
  };
}
