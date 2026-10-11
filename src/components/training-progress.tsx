'use client';
import { useState } from 'react';
import { Activity, Download, CheckCircle2, Timer, CalendarDays } from 'lucide-react';
import type { WorkspaceData, WorkoutSetView, ClientView } from '@/lib/types';
import { exercises, exerciseName } from '@/lib/catalog';
import { summarizeWorkouts, workoutCsv } from '@/lib/progress-metrics';
import { traineeInsight } from '@/lib/coaching-insights';
import { useTimeFormat } from './time-provider';
import { EmptyState, SectionTitle } from './ui';

const number = (value: number | null, suffix = '') =>
  value === null ? '—' : `${Math.round(value * 10) / 10}${suffix}`;
function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <section className="progress-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}
export function TrainingProgress({
  data,
  onPractice,
  initialClient = 'all',
}: {
  data: WorkspaceData;
  onPractice: () => void;
  initialClient?: string;
}) {
  const [days, setDays] = useState(30),
    [client, setClient] = useState(initialClient),
    [exercise, setExercise] = useState('all'),
    [source, setSource] = useState('all');
  const { dateLabel, timeLabel, timeZone } = useTimeFormat();
  const coach = data.user.role === 'coach';
  const cohort = coach && client === 'all';
  const sets = data.workoutSets.filter(
    (set) =>
      Date.parse(set.endedAt) >= Date.now() - days * 86400000 &&
      (cohort
        ? data.clients.some((person) => person.id === set.userId)
        : client === 'all'
          ? set.userId === data.user.id
          : set.userId === client) &&
      (exercise === 'all' || set.exercise === exercise) &&
      (source === 'all' || (source === 'live' ? !!set.classId : !set.classId)),
  );
  const totals = summarizeWorkouts(sets, timeZone);
  const checkIns = data.checkIns
    .filter(
      (entry) =>
        Date.parse(entry.createdAt) >= Date.now() - days * 86400000 &&
        (cohort
          ? data.clients.some((person) => person.id === entry.userId)
          : client === 'all'
            ? entry.userId === data.user.id
            : entry.userId === client),
    )
    .slice(0, 10);
  const legacy = data.classes
    .filter(
      (item) =>
        item.status === 'completed' &&
        Date.parse(item.startsAt) >= Date.now() - days * 86400000 &&
        source !== 'practice' &&
        exercise === 'all',
    )
    .map((item) => ({
      ...item,
      participants: item.participants.filter(
        (person) =>
          (client === 'all' || person.id === client) &&
          !data.workoutSets.some((set) => set.classId === item.id && set.userId === person.id),
      ),
    }))
    .filter((item) => item.participants.length > 0);
  return (
    <div className="training-progress">
      <div className="progress-toolbar">
        <div>
          <span className="eyebrow">TRAINING & CONSISTENCY</span>
          <h1>Your progress, measured.</h1>
          <p>Completed sets, observed movement, and coach-supported progress.</p>
        </div>
        <button
          className="button outline"
          disabled={!sets.length}
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([workoutCsv(sets)], { type: 'text/csv;charset=utf-8' }),
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = 'geez-squad-workouts.csv';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download size={16} />
          Export CSV
        </button>
      </div>
      <div className="progress-filters">
        <label>
          Period
          <select
            aria-label="Insights date range"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            {[7, 30, 90].map((value) => (
              <option key={value} value={value}>
                Last {value} days
              </option>
            ))}
          </select>
        </label>
        {coach && (
          <label>
            Client
            <select value={client} onChange={(event) => setClient(event.target.value)}>
              <option value="all">All studio trainees</option>
              <option value={data.user.id}>My practice</option>
              {data.clients.map((person) => (
                <option value={person.id} key={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Exercise
          <select value={exercise} onChange={(event) => setExercise(event.target.value)}>
            <option value="all">All exercises</option>
            {exercises.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Training
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="all">Live & practice</option>
            <option value="live">Live coaching</option>
            <option value="practice">Saved practice</option>
          </select>
        </label>
      </div>
      <div className="progress-metrics-grid">
        <Metric
          label={cohort ? 'Trainees with saved activity' : 'Training days'}
          value={
            cohort
              ? new Set(
                  sets.filter((set) => set.reps > 0 || set.holdMs > 0).map((set) => set.userId),
                ).size
              : totals.trainingDays
          }
          detail={`Within the selected ${days} days`}
        />
        <Metric
          label="Completed sets"
          value={totals.completedSets}
          detail={`${totals.sets} saved workout sets`}
        />
        <Metric
          label="Active training"
          value={`${number(totals.activeMs / 60000)} min`}
          detail="Observed intervals; pauses excluded"
        />
        <Metric
          label="Targets reached"
          value={totals.sets ? `${Math.round((totals.completedSets / totals.sets) * 100)}%` : '—'}
          detail="Sets that reached their rep or hold target"
        />
      </div>
      {!cohort && (
        <details className="panel measurement-details">
          <summary>Measurement details</summary>
          <p className="microcopy">
            Compare movement quality within the same exercise and rule version below.
          </p>
          <div className="progress-metrics-grid">
            <Metric label="Tracked reps" value={totals.reps} detail="Completed movement cycles" />
            <Metric
              label="Aligned holds"
              value={`${Math.round(totals.holdMs / 1000)}s`}
              detail="Observed plank / side-plank time"
            />
            <Metric
              label="Tracking coverage"
              value={number(totals.coverage, '%')}
              detail="Reliable tracked / observed active time"
            />
            <Metric
              label="Reported load volume"
              value={totals.loadedSets ? `${number(totals.loadVolume)} kg·reps` : '—'}
              detail="Entered external load × counted reps"
            />
          </div>
        </details>
      )}
      {cohort && (
        <section className="panel">
          <SectionTitle
            title="Trainee training progress"
            detail="Select a trainee to review their exercises and saved sets"
          />
          <div className="trainee-progress-list">
            {data.clients.map((person) => {
              const summary = summarizeWorkouts(
                sets.filter((set) => set.userId === person.id),
                timeZone,
              );
              return (
                <button
                  className="trainee-progress-row"
                  key={person.id}
                  onClick={() => setClient(person.id)}
                >
                  <strong>{person.name}</strong>
                  <span>{summary.completedSets} completed sets</span>
                  <span>{summary.trainingDays} training days</span>
                  <span className="text-link">View progress</span>
                </button>
              );
            })}
            {!data.clients.length && <p>Invite trainees to begin tracking their progress.</p>}
          </div>
        </section>
      )}
      {!sets.length ? (
        <EmptyState
          title={cohort ? 'No trainee sets in this period.' : 'Your next set starts your progress.'}
          text={
            cohort
              ? 'Saved trainee workouts appear here after training. Select another period or review an individual trainee.'
              : 'Saved workout details appear here after training. Enable saved history in practice, or join a live class with consent.'
          }
          action={
            !cohort ? (
              <button className="button lime" onClick={onPractice}>
                Open camera practice
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          {!cohort && (
            <section className="panel">
              <SectionTitle
                title="Exercise breakdown"
                detail="Compare the same movement and rule version with your coach"
              />
              <div className="exercise-progress-grid">
                {exercises
                  .filter((item) => sets.some((set) => set.exercise === item.id))
                  .flatMap((item) =>
                    [
                      ...new Set(
                        sets
                          .filter((set) => set.exercise === item.id)
                          .map((set) => set.ruleVersion),
                      ),
                    ].map((version) => {
                      const records = sets.filter(
                          (set) => set.exercise === item.id && set.ruleVersion === version,
                        ),
                        summary = summarizeWorkouts(records, timeZone);
                      const recentQuality = records
                        .filter((set) => set.qualityScore !== null)
                        .slice(0, 5)
                        .reverse()
                        .map((set) => Math.round(set.qualityScore!));
                      return (
                        <article key={`${item.id}-${version}`} className="exercise-progress-card">
                          <h3>{item.name}</h3>
                          <div className="exercise-progress-values">
                            <span>
                              <strong>
                                {summary.reps || `${Math.round(summary.holdMs / 1000)}s`}
                              </strong>
                              {summary.reps ? ' reps' : ' held'}
                            </span>
                            <span>{number(summary.quality, ' /100')} quality</span>
                          </div>
                          <dl>
                            <div>
                              <dt>Range</dt>
                              <dd>{number(summary.range, '°')}</dd>
                            </div>
                            <div>
                              <dt>Rep tempo</dt>
                              <dd>{number(summary.tempo, 's')}</dd>
                            </div>
                            <div>
                              <dt>Form</dt>
                              <dd>{number(summary.form, ' /100')}</dd>
                            </div>
                            <div>
                              <dt>Rejected cycles</dt>
                              <dd>{summary.rejectedReps}</dd>
                            </div>
                          </dl>
                          <small>
                            {summary.completedSets}/{summary.sets} targets reached · {version}
                          </small>
                          {!!recentQuality.length && (
                            <p className="microcopy">
                              Recent set quality: {recentQuality.join(' → ')}
                            </p>
                          )}
                        </article>
                      );
                    }),
                  )}
              </div>
            </section>
          )}
          <section className="panel">
            <SectionTitle title="Recent workout sets" detail="Last 50 records in this view" />
            <div className="workout-record-list">
              {sets.slice(0, 50).map((set) => (
                <WorkoutRecord
                  key={set.id}
                  set={set}
                  date={`${dateLabel(set.endedAt)} · ${timeLabel(set.endedAt)}`}
                  coach={coach}
                />
              ))}
            </div>
          </section>
        </>
      )}
      {!!legacy.length && (
        <section className="panel">
          <SectionTitle
            title="Earlier session summaries"
            detail="Legacy totals are kept separately from detailed sets"
          />
          <div className="legacy-summary">
            <span>
              <CalendarDays size={16} />
              {legacy.length} completed sessions
            </span>
            <span>
              {legacy.reduce(
                (total, item) =>
                  total +
                  item.participants
                    .filter((person) => client === 'all' || person.id === client)
                    .reduce((sum, person) => sum + (person.summary?.totalReps ?? 0), 0),
                0,
              )}{' '}
              reported reps
            </span>
            <span>
              {legacy.reduce(
                (total, item) =>
                  total +
                  item.participants
                    .filter((person) => client === 'all' || person.id === client)
                    .reduce((sum, person) => sum + (person.summary?.totalHoldSeconds ?? 0), 0),
                0,
              )}{' '}
              seconds held
            </span>
          </div>
        </section>
      )}
      {!!checkIns.length && (
        <section className="panel">
          <SectionTitle
            title="Check-in history"
            detail="Latest 10 reports in the selected period"
          />
          {checkIns.map((entry) => (
            <article className="client-check-in" key={entry.id}>
              <strong>
                {coach ? `${entry.userName} · ` : ''}
                {dateLabel(entry.createdAt)}
              </strong>
              <span>
                Energy {entry.energy}/5 · Soreness {entry.soreness}/5
                {entry.effort === null ? '' : ` · Effort ${entry.effort}/10`}
              </span>
              <span>
                {entry.sleepHours === null ? '' : `Sleep ${entry.sleepHours}h`}
                {entry.bodyweightKg === null ? '' : ` · Bodyweight ${entry.bodyweightKg}kg`}
              </span>
              {entry.note && <p>{entry.note}</p>}
            </article>
          ))}
        </section>
      )}
      <p className="microcopy">
        Camera scores estimate visible movement. Load and check-ins are self-reported. Missing
        measurements stay unavailable. Showing up to the latest 500 sets.
      </p>
    </div>
  );
}
function WorkoutRecord({
  set,
  date,
  coach,
}: {
  set: WorkoutSetView;
  date: string;
  coach: boolean;
}) {
  return (
    <article className="workout-record">
      <div>
        <strong>{exerciseName(set.exercise)}</strong>
        <span>
          {coach ? `${set.userName} · ` : ''}
          {set.classTitle ?? 'Practice'} · {date}
        </span>
      </div>
      <div>
        <strong>{set.holdMs ? `${Math.round(set.holdMs / 1000)}s` : `${set.reps} reps`}</strong>
        <span>
          Set {set.setNumber} · target {set.target}
        </span>
      </div>
      <div>
        <strong>{number(set.qualityScore, ' /100')}</strong>
        <span>Rep quality</span>
      </div>
      <span className={`pill ${set.completed ? 'target-complete' : ''}`}>
        {set.completed ? 'Target reached' : 'Finished early'}
      </span>
    </article>
  );
}
export function CheckInForm({
  onSave,
  busy,
}: {
  onSave: (data: Record<string, unknown>) => Promise<unknown>;
  busy: boolean;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="form-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const optional = (name: string) => (form.get(name) === '' ? null : Number(form.get(name)));
        try {
          await onSave({
            action: 'checkIn',
            energy: Number(form.get('energy')),
            soreness: Number(form.get('soreness')),
            effort: optional('effort'),
            sleepHours: optional('sleepHours'),
            bodyweightKg: optional('bodyweightKg'),
            note: form.get('note'),
          });
          setSaved(true);
        } catch {
          /* The workspace displays the server error beside this form. */
        }
      }}
    >
      <p>
        Share how you feel with your coach. These are your reports, separate from camera scores.
      </p>
      <div className="form-two">
        <label>
          Energy (1–5)
          <select name="energy" defaultValue="3">
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Soreness (0–5)
          <select name="soreness" defaultValue="0">
            {[0, 1, 2, 3, 4, 5].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Workout effort (1–10, optional)
          <input type="number" name="effort" min={1} max={10} />
        </label>
        <label>
          Sleep (hours, optional)
          <input type="number" name="sleepHours" min={0} max={24} step={0.5} />
        </label>
        <label>
          Bodyweight (kg, optional)
          <input type="number" name="bodyweightKg" min={20} max={500} step={0.1} />
        </label>
      </div>
      <label>
        Anything your coach should know?
        <textarea name="note" maxLength={600} rows={3} />
      </label>
      <button className="button dark" disabled={busy || saved}>
        {saved ? 'Check-in saved' : 'Share check-in with my coach'}
      </button>
      {saved && <p role="status">Your check-in is saved.</p>}
    </form>
  );
}
export function ClientCoaching({
  client,
  data,
  onSave,
  busy,
  onProgress,
}: {
  client: ClientView;
  data: WorkspaceData;
  onSave: (data: Record<string, unknown>) => Promise<unknown>;
  busy: boolean;
  onProgress: () => void;
}) {
  const { dateLabel } = useTimeFormat();
  const assignment = data.assignments.find((item) => item.userId === client.id),
    entries = [
      ...new Map(
        [
          ...(client.latestCheckIn ? [client.latestCheckIn] : []),
          ...data.checkIns.filter((item) => item.userId === client.id),
        ].map((entry) => [entry.id, entry]),
      ).values(),
    ].slice(0, 5);
  const insight = traineeInsight(data, client);
  const [message, setMessage] = useState('');
  return (
    <div className="client-coaching">
      <div className="client-training-summary">
        <span>
          <CheckCircle2 size={16} />
          {insight.completedSetsThisWeek} completed sets in 7 days
        </span>
        <span>
          <Timer size={16} />
          Last activity:{' '}
          {insight.lastTrainingAt ? dateLabel(insight.lastTrainingAt) : 'No saved sets'}
        </span>
        <span>
          <Activity size={16} />
          {insight.recentCheckIn
            ? `Energy ${insight.recentCheckIn.energy}/5 · Soreness ${insight.recentCheckIn.soreness}/5`
            : 'No check-in in 24 hours'}
        </span>
      </div>
      <button className="button outline" onClick={onProgress}>
        View training progress
      </button>
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          try {
            await onSave({
              action: 'assignPlan',
              userId: client.id,
              planId: form.get('planId') || null,
            });
            setMessage('Assignment saved.');
          } catch {
            setMessage('');
          }
        }}
      >
        <label>
          Assigned workout plan
          <select name="planId" defaultValue={assignment?.planId ?? ''}>
            <option value="">No assignment</option>
            {data.plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button outline" disabled={busy}>
          Save assignment
        </button>
      </form>
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          try {
            await onSave({ action: 'coachNote', userId: client.id, note: form.get('note') });
            setMessage('Private coach note saved.');
          } catch {
            setMessage('');
          }
        }}
      >
        <label>
          Private coach notes
          <textarea name="note" defaultValue={client.coachNote ?? ''} maxLength={2000} rows={3} />
        </label>
        <p className="microcopy">Visible only to you. Trainees cannot read this note.</p>
        <button className="button outline" disabled={busy}>
          Save coach note
        </button>
      </form>
      {message && <p role="status">{message}</p>}
      <h3>Recent check-ins</h3>
      {entries.length ? (
        entries.map((entry) => (
          <article className="client-check-in" key={entry.id}>
            <strong>{dateLabel(entry.createdAt)}</strong>
            <span>
              Energy {entry.energy}/5 · Soreness {entry.soreness}/5
              {entry.effort ? ` · Effort ${entry.effort}/10` : ''}
            </span>
            <span>
              {entry.sleepHours !== null ? `${entry.sleepHours}h sleep` : ''}
              {entry.bodyweightKg !== null ? ` · ${entry.bodyweightKg}kg` : ''}
            </span>
            {entry.note && <p>{entry.note}</p>}
          </article>
        ))
      ) : (
        <p className="microcopy">This client has not shared a check-in yet.</p>
      )}
    </div>
  );
}
