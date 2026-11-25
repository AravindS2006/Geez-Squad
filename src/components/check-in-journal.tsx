'use client';
import { useId, useState } from 'react';
import { Check, Minus, Plus, X } from 'lucide-react';
import {
  clockLabel,
  clockMinutes,
  emptyJournal,
  isEmptyJournal,
  normalizeJournal,
  type CheckInJournal,
} from '@/lib/daily-check-in';
import styles from './check-in-journal.module.css';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

function Question({
  label,
  children,
  follow = false,
  stack = false,
}: {
  label: string;
  children: (labelId: string) => React.ReactNode;
  follow?: boolean;
  /** Lets wide controls drop below the question on phones. */
  stack?: boolean;
}) {
  const id = useId();
  return (
    <div className={`${follow ? styles.follow : styles.question} ${stack ? styles.stack : ''}`}>
      <span id={id} className={styles.label}>
        {label}
      </span>
      {children(id)}
    </div>
  );
}

function YesNo({
  labelId,
  value,
  onChange,
}: {
  labelId: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}) {
  return (
    <div className={styles.yesNo} role="group" aria-labelledby={labelId}>
      <button
        type="button"
        className={styles.no}
        aria-label="No"
        aria-pressed={value === false}
        onClick={() => onChange(value === false ? null : false)}
      >
        <X size={18} aria-hidden />
      </button>
      <button
        type="button"
        className={styles.yes}
        aria-label="Yes"
        aria-pressed={value === true}
        onClick={() => onChange(value === true ? null : true)}
      >
        <Check size={18} aria-hidden />
      </button>
    </div>
  );
}

function Stepper({
  labelId,
  value,
  onChange,
  min,
  max,
  step = 1,
  start,
  unit = '',
}: {
  labelId: string;
  value: number | null;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** First value when the trainee taps a stepper that has no answer yet. */
  start: number;
  unit?: string;
}) {
  const move = (direction: 1 | -1) =>
    onChange(
      value === null
        ? start
        : Math.min(max, Math.max(min, Math.round((value + direction * step) * 10) / 10)),
    );
  return (
    <div className={styles.stepper} role="group" aria-labelledby={labelId}>
      <button
        type="button"
        aria-label="Decrease"
        disabled={value !== null && value <= min}
        onClick={() => move(-1)}
      >
        <Minus size={16} aria-hidden />
      </button>
      <output className={value === null ? styles.unset : styles.value} aria-live="polite">
        {value === null ? 'Add' : `${value}${unit}`}
      </output>
      <button
        type="button"
        aria-label="Increase"
        disabled={value !== null && value >= max}
        onClick={() => move(1)}
      >
        <Plus size={16} aria-hidden />
      </button>
    </div>
  );
}

function TimeSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className={styles.time}>
      <div className={styles.timeHead}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        <span className={styles.clock}>{value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={23 * 60 + 45}
        step={15}
        value={clockMinutes(value)}
        aria-valuetext={value}
        onChange={(event) => onChange(clockLabel(Number(event.target.value)))}
      />
    </div>
  );
}

function Scale({
  labelId,
  values,
  value,
  onChange,
}: {
  labelId: string;
  values: number[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className={styles.scale} role="radiogroup" aria-labelledby={labelId}>
      {values.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/** The trainee's daily check-in: how they feel today and what happened yesterday. */
export function CheckInForm({
  onSave,
  busy,
}: {
  onSave: (data: Record<string, unknown>) => Promise<unknown>;
  busy: boolean;
}) {
  const [energy, setEnergy] = useState(3);
  const [soreness, setSoreness] = useState(0);
  const [sleepHours, setSleepHours] = useState<number | null>(null);
  const [effort, setEffort] = useState<number | null>(null);
  const [bodyweightKg, setBodyweightKg] = useState('');
  const [note, setNote] = useState('');
  const [journal, setJournal] = useState<CheckInJournal>(emptyJournal);
  const [saved, setSaved] = useState(false);
  const [attendance, setAttendance] = useState(0);
  const set = (patch: Partial<CheckInJournal>) =>
    setJournal((current) => ({ ...current, ...patch }));
  return (
    <form
      className={styles.journal}
      onSubmit={async (event) => {
        event.preventDefault();
        const answers = normalizeJournal(journal);
        try {
          const result = await onSave({
            action: 'checkIn',
            energy,
            soreness,
            effort,
            sleepHours,
            bodyweightKg: bodyweightKg === '' ? null : Number(bodyweightKg),
            note,
            journal: isEmptyJournal(answers) ? null : answers,
          });
          const recorded = (result as { attendanceRecorded?: unknown } | null)?.attendanceRecorded;
          setAttendance(typeof recorded === 'number' ? recorded : 0);
          setSaved(true);
        } catch {
          /* The workspace displays the server error beside this form. */
        }
      }}
    >
      <p className={styles.intro}>
        Share how you feel with your coach. These are your reports, separate from camera scores.
      </p>
      <Section title="Today">
        <Question label="Energy (1–5)" stack>
          {(id) => (
            <Scale labelId={id} values={[1, 2, 3, 4, 5]} value={energy} onChange={setEnergy} />
          )}
        </Question>
        <Question label="Soreness (0–5)" stack>
          {(id) => (
            <Scale
              labelId={id}
              values={[0, 1, 2, 3, 4, 5]}
              value={soreness}
              onChange={setSoreness}
            />
          )}
        </Question>
      </Section>
      <h3 className={styles.heading}>What happened yesterday?</h3>
      <Section title="Recovery">
        <Question label="How long did you sleep?">
          {(id) => (
            <Stepper
              labelId={id}
              value={sleepHours}
              onChange={setSleepHours}
              min={0}
              max={24}
              step={0.5}
              start={7}
              unit="h"
            />
          )}
        </Question>
        <Question label="Workout effort (1–10)">
          {(id) => (
            <Stepper labelId={id} value={effort} onChange={setEffort} min={1} max={10} start={6} />
          )}
        </Question>
      </Section>
      <Section title="Circadian health">
        <Question label="See direct sunlight upon waking up?">
          {(id) => (
            <YesNo
              labelId={id}
              value={journal.sunlight}
              onChange={(sunlight) =>
                set({
                  sunlight,
                  sunlightMinutes: journal.sunlightMinutes ?? 10,
                  sunlightAt: journal.sunlightAt ?? '07:00',
                })
              }
            />
          )}
        </Question>
        {journal.sunlight && (
          <>
            <Question label="For how long (minutes)?" follow>
              {(id) => (
                <Stepper
                  labelId={id}
                  value={journal.sunlightMinutes}
                  onChange={(sunlightMinutes) => set({ sunlightMinutes })}
                  min={1}
                  max={240}
                  step={5}
                  start={10}
                  unit=" min"
                />
              )}
            </Question>
            <TimeSlider
              label="When did this occur?"
              value={journal.sunlightAt ?? '07:00'}
              onChange={(sunlightAt) => set({ sunlightAt })}
            />
          </>
        )}
      </Section>
      <Section title="Lifestyle">
        <Question label="Experience any stress?">
          {(id) => (
            <YesNo labelId={id} value={journal.stress} onChange={(stress) => set({ stress })} />
          )}
        </Question>
        <Question label="Have any alcoholic drinks?">
          {(id) => (
            <YesNo
              labelId={id}
              value={journal.alcohol}
              onChange={(alcohol) => set({ alcohol, alcoholDrinks: journal.alcoholDrinks ?? 1 })}
            />
          )}
        </Question>
        {journal.alcohol && (
          <Question label="How many drinks?" follow>
            {(id) => (
              <Stepper
                labelId={id}
                value={journal.alcoholDrinks}
                onChange={(alcoholDrinks) => set({ alcoholDrinks })}
                min={1}
                max={20}
                start={1}
              />
            )}
          </Question>
        )}
        <Question label="Have any caffeine?">
          {(id) => (
            <YesNo
              labelId={id}
              value={journal.caffeine}
              onChange={(caffeine) =>
                set({
                  caffeine,
                  caffeineServings: journal.caffeineServings ?? 1,
                  caffeineLastAt: journal.caffeineLastAt ?? '14:00',
                })
              }
            />
          )}
        </Question>
        {journal.caffeine && (
          <>
            <Question label="How many servings?" follow>
              {(id) => (
                <Stepper
                  labelId={id}
                  value={journal.caffeineServings}
                  onChange={(caffeineServings) => set({ caffeineServings })}
                  min={1}
                  max={20}
                  start={1}
                />
              )}
            </Question>
            <TimeSlider
              label="When was your last serving?"
              value={journal.caffeineLastAt ?? '14:00'}
              onChange={(caffeineLastAt) => set({ caffeineLastAt })}
            />
          </>
        )}
        <Question label="Hydrated sufficiently?">
          {(id) => (
            <YesNo
              labelId={id}
              value={journal.hydrated}
              onChange={(hydrated) => set({ hydrated })}
            />
          )}
        </Question>
      </Section>
      <Section title="Notes">
        <label className={styles.field}>
          Bodyweight (kg, optional)
          <input
            type="number"
            inputMode="decimal"
            min={20}
            max={500}
            step={0.1}
            value={bodyweightKg}
            onChange={(event) => setBodyweightKg(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          Anything your coach should know?
          <textarea
            maxLength={600}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </Section>
      <button className="button dark" disabled={busy || saved}>
        {saved ? 'Check-in saved' : 'Share check-in with my coach'}
      </button>
      {saved && (
        <p role="status">
          {attendance
            ? "Your check-in is saved. Today's studio visit is recorded."
            : 'Your check-in is saved. Studio attendance needs an active membership.'}
        </p>
      )}
    </form>
  );
}
