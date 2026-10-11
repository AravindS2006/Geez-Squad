import type { ClientView, WorkspaceData } from './types';
import { summarizeWorkouts } from './progress-metrics';

export function traineeInsight(data: WorkspaceData, person: ClientView, now = Date.now()) {
  const sets = data.workoutSets.filter((set) => set.userId === person.id);
  const checkIn =
    person.latestCheckIn ??
    data.checkIns
      .filter((entry) => entry.userId === person.id)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ??
    null;
  const recentCheckIn =
    checkIn &&
    now - Date.parse(checkIn.createdAt) <= 86400000 &&
    Date.parse(checkIn.createdAt) <= now
      ? checkIn
      : null;
  const assignment = data.assignments.find((item) => item.userId === person.id);
  const plan = data.plans.find((item) => item.id === assignment?.planId) ?? null;
  const savedActivity = sets
    .filter((set) => set.reps > 0 || set.holdMs > 0)
    .map((set) => set.endedAt);
  const lastTrainingAt =
    [person.lastTrainingAt, ...savedActivity]
      .filter(Boolean)
      .sort((a, b) => Date.parse(b!) - Date.parse(a!))[0] ?? null;
  const reasons: string[] = [];
  if (recentCheckIn?.energy && recentCheckIn.energy <= 2) reasons.push('Low energy reported');
  if (recentCheckIn && recentCheckIn.soreness >= 4) reasons.push('High soreness reported');
  if (!plan) reasons.push('No assigned plan');
  if (
    now - Date.parse(person.joinedAt) >= 7 * 86400000 &&
    (!lastTrainingAt || now - Date.parse(lastTrainingAt) >= 7 * 86400000)
  )
    reasons.push('No saved activity in 7 days');
  return {
    person,
    checkIn,
    recentCheckIn,
    plan,
    lastTrainingAt,
    reasons,
    completedSetsThisWeek:
      person.completedSetsThisWeek ??
      sets.filter((set) => set.completed && Date.parse(set.endedAt) >= now - 7 * 86400000).length,
  };
}

export function coachingOverview(data: WorkspaceData, timeZone = 'UTC', now = Date.now()) {
  const coach = data.user.role === 'coach';
  const trainees = data.clients.map((person) => traineeInsight(data, person, now));
  const upcoming = data.classes.filter(
    (item) =>
      item.status === 'live' ||
      (item.status === 'scheduled' &&
        Date.parse(item.startsAt) >= now &&
        Date.parse(item.startsAt) <= now + 7 * 86400000),
  );
  const ownSets = data.workoutSets.filter(
    (set) =>
      set.userId === data.user.id &&
      Date.parse(set.endedAt) >= now - 7 * 86400000 &&
      Date.parse(set.endedAt) <= now,
  );
  const own = summarizeWorkouts(ownSets, timeZone);
  const followUps = trainees
    .filter((item) => item.reasons.length > 0)
    .sort((a, b) => {
      const priority = (item: typeof a) =>
        item.reasons.filter((reason) => reason.endsWith('reported')).length;
      return (
        priority(b) - priority(a) ||
        b.reasons.length - a.reasons.length ||
        a.person.name.localeCompare(b.person.name)
      );
    });
  return {
    trainees,
    followUps,
    upcoming,
    own,
    cards: coach
      ? [
          {
            label: 'Studio trainees',
            value: data.clients.length,
            detail: 'Current studio members',
          },
          {
            label: 'Upcoming sessions',
            value: upcoming.length,
            detail: 'Live now and the next 7 days',
          },
          {
            label: 'Recent check-ins',
            value: trainees.filter((item) => item.recentCheckIn).length,
            detail: 'Trainees who reported in the last 24 hours',
          },
          {
            label: 'Follow-ups',
            value: followUps.length,
            detail: 'Check-ins, plans, and saved activity',
          },
        ]
      : [
          {
            label: 'Upcoming sessions',
            value: upcoming.length,
            detail: 'Live now and the next 7 days',
          },
          {
            label: 'Training days',
            value: own.trainingDays,
            detail: 'Saved activity in the last 7 days',
          },
          {
            label: 'Completed sets',
            value: own.completedSets,
            detail: 'Targets reached in the last 7 days',
          },
          {
            label: 'Active training',
            value: `${Math.round(own.activeMs / 60000)} min`,
            detail: 'Observed active time in the last 7 days',
          },
        ],
  };
}
