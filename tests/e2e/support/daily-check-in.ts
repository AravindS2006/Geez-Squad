import type { BrowserContext } from '@playwright/test';
import { dailyCheckInPromptKey } from '../../../src/lib/daily-check-in';
import { studioToday } from '../../../src/lib/studio-operations';

/**
 * Marks today's automatic check-in as already shown for this user, so specs that are not
 * about the check-in land on Home without the dialog. Uses the app's own key and day.
 */
export async function skipDailyCheckIn(context: BrowserContext, userId: string) {
  await context.addInitScript(([key, day]) => localStorage.setItem(key, day), [
    dailyCheckInPromptKey(userId),
    studioToday(),
  ] as const);
}
