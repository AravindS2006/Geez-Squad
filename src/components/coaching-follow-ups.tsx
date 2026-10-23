'use client';
import type { ClientView, WorkspaceData } from '@/lib/types';
import { coachingOverview } from '@/lib/coaching-insights';
import { SectionTitle, Avatar, TextAction } from './ui';
import { useTimeFormat } from './time-provider';

export function CoachingFollowUps({
  data,
  onClient,
  onCheckIn,
  onReviewAll,
}: {
  data: WorkspaceData;
  onClient: (person: ClientView) => void;
  onCheckIn: () => void;
  onReviewAll: () => void;
}) {
  const { timeZone, dateLabel } = useTimeFormat();
  const overview = coachingOverview(data, timeZone);
  if (data.user.role !== 'coach') {
    const latest = data.checkIns.find((entry) => entry.userId === data.user.id);
    return (
      <section className="panel coaching-focus-panel">
        <SectionTitle title="Your training focus" />
        <h3>{data.user.goal}</h3>
        {latest ? (
          <p>
            Last check-in: {dateLabel(latest.createdAt)} · Energy {latest.energy}/5 · Soreness{' '}
            {latest.soreness}/5
          </p>
        ) : (
          <p>Share your energy and soreness before your next workout.</p>
        )}
        <button className="button outline" onClick={onCheckIn}>
          Update my check-in
        </button>
      </section>
    );
  }
  return (
    <section className="panel coaching-focus-panel">
      <SectionTitle
        title="Coaching follow-ups"
        detail="Review the person before adjusting their workout"
        action={<TextAction onClick={onReviewAll}>Review all</TextAction>}
      />
      {overview.followUps.length ? (
        <div className="follow-up-list">
          {overview.followUps.slice(0, 4).map(({ person, reasons }) => (
            <button key={person.id} className="follow-up-row" onClick={() => onClient(person)}>
              <Avatar name={person.name} small />
              <span>
                <strong>{person.name}</strong>
                <small>{reasons.join(' · ')}</small>
              </span>
              <span className="text-link">Review</span>
            </button>
          ))}
          {overview.followUps.length > 4 && (
            <p className="microcopy">
              {overview.followUps.length - 4} more follow-ups are available in trainee profiles.
            </p>
          )}
        </div>
      ) : (
        <p>
          {data.clients.length
            ? 'No current follow-ups from shared check-ins, plans, or saved activity.'
            : data.permissions?.admin || data.demo
              ? 'Add a member and connect their account to build your coaching roster.'
              : 'An admin can assign trainees to you from Team.'}
        </p>
      )}
      <p className="microcopy">
        Check-ins are trainee reports. Saved activity does not measure class attendance.
      </p>
    </section>
  );
}
