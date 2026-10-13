type TimedSession = {
  status: string;
  startsAt: string;
  startedAt: string | null;
  endedAt: string | null;
  duration: number;
};

/** Wall-clock meeting time, including class pauses; never exercise active time. */
export function sessionElapsedSeconds(session: TimedSession, now: number) {
  if (!session.startedAt) return 0;
  const end = session.endedAt ? Date.parse(session.endedAt) : now;
  // A terminal session without an end timestamp must not keep running forever.
  if (['completed', 'cancelled'].includes(session.status) && !session.endedAt) return 0;
  return Math.max(0, Math.floor((end - Date.parse(session.startedAt)) / 1000)) || 0;
}

export function compareSessions(
  a: Pick<TimedSession, 'status' | 'startsAt'>,
  b: Pick<TimedSession, 'status' | 'startsAt'>,
) {
  const rank = (status: string) => (status === 'live' ? 0 : status === 'scheduled' ? 1 : 2);
  const difference = rank(a.status) - rank(b.status);
  if (difference) return difference;
  return rank(a.status) < 2
    ? Date.parse(a.startsAt) - Date.parse(b.startsAt)
    : Date.parse(b.startsAt) - Date.parse(a.startsAt);
}

export function localDateTime(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Reject nonexistent local times instead of silently moving them across a DST gap. */
export function parseSessionTime(value: string, original?: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || localDateTime(date) !== value) return null;
  // Preserve the original instant (and seconds) when only the title/roster changes,
  // including the second occurrence of an ambiguous daylight-saving hour.
  if (original && localDateTime(new Date(original)) === value) return original;
  return date.toISOString();
}
