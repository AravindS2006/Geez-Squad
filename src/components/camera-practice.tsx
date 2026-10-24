'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, X } from 'lucide-react';
import type { WorkspaceData, ClassView } from '@/lib/types';
import { exercises, exerciseName } from '@/lib/catalog';
import { exerciseDefinition } from '@/lib/exercise-library';
import { planBlocks } from '@/lib/workout-run';
import { ExerciseArt } from './ui';
import { WorkoutPlayer } from './workout-player';
import styles from './camera-practice.module.css';
export function CameraPractice({ data }: { data: WorkspaceData }) {
  const assignment = data.assignments.find((a) => a.userId === data.user.id);
  const rawPlan = data.plans.find((p) => p.id === assignment?.planId);
  const plan = useMemo(
    () => (rawPlan ? { ...rawPlan, blocks: planBlocks(rawPlan) } : undefined),
    [rawPlan],
  );
  const [guideOpen, setGuideOpen] = useState(false);
  const [exercise, setExercise] = useState<ClassView['exercise']>(
    plan?.blocks[0]?.exercise ?? 'squat',
  );
  const [saveHistory, setSaveHistory] = useState(false);
  const [assignedBlock, setAssignedBlock] = useState(plan ? 0 : -1);
  const [readyNext, setReadyNext] = useState(false);
  const [runId] = useState(() => crypto.randomUUID());
  const definition = exerciseDefinition(exercise, data.customExercises);
  return (
    <section
      className={`meeting-practice ${styles.practice}`}
      aria-label="Camera practice workspace"
    >
      <header className={`practice-heading ${styles.heading}`}>
        <Link
          href={data.demo ? '/demo' : '/app'}
          className={styles.back}
          aria-label="Back to workspace"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <span className="eyebrow">CAMERA PRACTICE</span>
          <h1>Your space to move.</h1>
        </div>
        <label>
          Movement
          <select
            aria-label="Exercise to practice"
            value={exercise}
            onChange={(event) => {
              setAssignedBlock(-1);
              setReadyNext(false);
              setExercise(event.target.value as ClassView['exercise']);
            }}
          >
            {[...exercises, ...(data.customExercises ?? [])]
              .filter((x) => data.features?.library !== false || x.profileId)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
        </label>
        <button
          className={styles.guideToggle}
          aria-label="Movement guide"
          onClick={() => setGuideOpen(!guideOpen)}
          aria-expanded={guideOpen}
          aria-controls="practice-movement-guide"
        >
          <BookOpen size={18} />
          <span>Movement guide</span>
        </button>
      </header>
      {(plan || !data.demo) && (
        <div className={`practice-options ${styles.options}`}>
          {plan && (
            <label>
              Assigned plan: {plan.name}
              <select
                aria-label="Assigned plan exercise"
                value={assignedBlock}
                onChange={(event) => {
                  const index = Number(event.target.value);
                  setAssignedBlock(index);
                  setReadyNext(false);
                  if (index >= 0) setExercise(plan.blocks[index].exercise);
                }}
              >
                <option value={-1}>Choose an exercise</option>
                {plan.blocks.map((block, index) => (
                  <option key={index} value={index}>
                    {index + 1}. {exerciseName(block.exercise)} · {block.sets} sets
                  </option>
                ))}
              </select>
            </label>
          )}
          {!data.demo && (
            <label className="history-consent">
              <input
                type="checkbox"
                checked={saveHistory}
                onChange={(event) => setSaveHistory(event.target.checked)}
              />
              <span>Save workout history to my profile and share with my coach</span>
            </label>
          )}
        </div>
      )}
      <div className={`practice-studio-grid ${styles.studio}`}>
        <div className={`practice-session ${styles.session}`}>
          <WorkoutPlayer
            runId={runId}
            customExercises={data.customExercises}
            features={data.features}
            onWorkoutComplete={() => setReadyNext(true)}
            exercise={exercise}
            block={
              assignedBlock >= 0 && plan?.blocks[assignedBlock]?.exercise === exercise
                ? plan.blocks[assignedBlock]
                : undefined
            }
            saveForUser={saveHistory ? data.user.id : undefined}
            historyUserId={!data.demo ? data.user.id : undefined}
          />
        </div>
        <aside
          id="practice-movement-guide"
          className={`practice-coaching-guide panel ${styles.guide}`}
          aria-label="Movement guide"
          hidden={!guideOpen}
        >
          <div className={styles.guideHeading}>
            <span className="eyebrow">MOVEMENT GUIDE</span>
            <button onClick={() => setGuideOpen(false)} aria-label="Close movement guide">
              <X size={18} />
            </button>
          </div>
          <ExerciseArt exercise={exercise} />
          <h2>{definition.name}</h2>
          <p>{definition.equipment}</p>
          <h3>Set up your space</h3>
          <p>{definition.view}</p>
          <h3>Move with intention</h3>
          <ol>
            {definition.instructions.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <div className="practice-steps">
            <span>01 · Frame your full movement</span>
            <span>02 · Choose your set and arm mode</span>
            <span>03 · Start when you’re ready</span>
          </div>
          <p>
            Keep hands and feet inside the frame. If tracking becomes uncertain, pause and reframe
            or choose manual tracking.
          </p>
        </aside>
      </div>
      {plan && assignedBlock >= 0 && (
        <details className={styles.sequence}>
          <summary>
            {plan.name} · Exercise {assignedBlock + 1} of {plan.blocks.length}
            {readyNext ? ' · Ready for next exercise' : ' · Workout sequence'}
          </summary>
          <section className="panel workout-queue" aria-label="Assigned workout sequence">
            <h3>{plan.name}</h3>
            <ol>
              {plan.blocks.map((b, i) => (
                <li key={b.id} aria-current={i === assignedBlock ? 'step' : undefined}>
                  {exerciseDefinition(b.exercise, data.customExercises).name} · {b.sets} sets{' '}
                  {i < assignedBlock
                    ? '· finished or skipped'
                    : i === assignedBlock
                      ? '· current'
                      : ''}
                </li>
              ))}
            </ol>
            {assignedBlock < plan.blocks.length - 1 ? (
              <button
                className="button dark"
                onClick={() => {
                  const next = assignedBlock + 1;
                  setAssignedBlock(next);
                  setExercise(plan.blocks[next].exercise);
                  setReadyNext(false);
                }}
              >
                {readyNext ? 'Next exercise' : 'Finish early and skip to next exercise'}
              </button>
            ) : (
              readyNext && (
                <p role="status">Assigned workout finished. Review your saved sets in Insights.</p>
              )
            )}
          </section>
        </details>
      )}
      <p className={`practice-privacy ${styles.privacy}`}>
        Camera frames are processed on this device.{' '}
        {saveHistory
          ? 'Set summaries are saved to your profile and available to your coach.'
          : 'Practice history stays on this page unless you enable saving.'}
      </p>
    </section>
  );
}
