import type { BrowserContext } from '@playwright/test';
import { dailyCheckInSkipKey } from '../../../src/lib/daily-check-in';
import { studioToday } from '../../../src/lib/studio-operations';

/**
 * Seeds the app's per-device skip for today, so specs that are not about the check-in land
 * on Home without the dialog. Uses the app's own key and day.
 */
export async function skipDailyCheckIn(context: BrowserContext, userId: string) {
  await context.addInitScript(([key, day]) => localStorage.setItem(key, day), [
    dailyCheckInSkipKey(userId),
    studioToday(),
  ] as const);
}
