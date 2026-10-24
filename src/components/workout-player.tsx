'use client';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import dynamic from 'next/dynamic';
import type { CameraAnalyzer } from './camera-analyzer';
import type { ExerciseDefinition } from '@/lib/exercise-library';
import {
  exerciseDefinition,
  isAutomaticExercise,
  capabilityLabels,
  armModeLabels,
  type ArmMode,
} from '@/lib/exercise-library';
import { defaultWorkoutConfig } from '@/lib/workout-config';
import type { Analysis } from '@/lib/pose-engine';
import type { WorkoutSetRecord } from '@/lib/types';
import { saveWorkoutSet, retryWorkoutSets } from '@/lib/workout-save';
import { coachingFeatures, type CoachingFeatures } from '@/lib/coaching-features';
import { readRunCheckpoint, type RunCheckpoint } from '@/lib/workout-run';
import { workoutSetSchema } from '@/lib/validation';
import { useCameraLayout } from './use-camera-layout';
import { requestCamera } from '@/lib/camera-access';

const AutomaticWorkout = dynamic(() => import('./camera-analyzer').then((m) => m.CameraAnalyzer), {
  ssr: false,
  loading: () => (
    <div className="camera-module-loading" role="status">
      Loading camera controls…
    </div>
  ),
});
type Props = ComponentProps<typeof CameraAnalyzer> & {
  customExercises?: ExerciseDefinition[];
  features?: CoachingFeatures;
  initialArmMode?: ArmMode;
};

export function WorkoutPlayer(props: Props) {
  const [manual, setManual] = useState(false);
  const [warming, setWarming] = useState(false);
  const totals = useRef({ reps: props.initialReps ?? 0, holds: props.initialHoldSeconds ?? 0 });
  const lastArmMode = useRef<ArmMode | undefined>(props.block?.armMode);
  const definition = exerciseDefinition(props.exercise, props.customExercises);
  const [pinnedFeatures] = useState(() => props.features ?? coachingFeatures());
  const automatic = isAutomaticExercise(props.exercise) && pinnedFeatures.measurement && !manual;
  useEffect(() => {
    setManual(false);
    totals.current = { reps: props.initialReps ?? 0, holds: props.initialHoldSeconds ?? 0 };
  }, [props.exercise, props.revision, props.block?.id]);
  const observe = (analysis: Analysis) => {
    if (analysis.armMode) lastArmMode.current = analysis.armMode;
    totals.current = { reps: analysis.reps, holds: analysis.holdSeconds };
    props.onAnalysis?.(analysis);
  };
  return (
    <div className="workout-player">
      <div className="workout-capability">
        <span>
          {automatic
            ? capabilityLabels.beta
            : definition.targetUnit === 'seconds'
              ? 'Timed activity'
              : 'Manual repetitions'}
        </span>
        <span>{definition.name}</span>
        {isAutomaticExercise(props.exercise) && pinnedFeatures.measurement && (
          <button type="button" className="text-link" onClick={() => setManual((v) => !v)}>
            {manual ? 'Use camera counting' : 'Use manual tracking'}
          </button>
        )}
        <button type="button" className="text-link" onClick={() => setWarming((v) => !v)}>
          {warming ? 'Finish warm-up' : 'Warm up first'}
        </button>
      </div>
      {warming && (
        <div className="inline-notice" role="status">
          Warm-up · Follow your coach’s preparation. Warm-up movements are excluded from your
          working sets.
        </div>
      )}
      {automatic ? (
        <AutomaticWorkout {...props} paused={props.paused || warming} onAnalysis={observe} />
      ) : (
        <ManualWorkout
          key={`${props.exercise}:${props.revision}:${props.block?.id ?? ''}`}
          {...props}
          initialArmMode={props.block?.armMode ?? lastArmMode.current}
          initialReps={totals.current.reps}
          initialHoldSeconds={totals.current.holds}
          paused={props.paused || warming}
          definition={definition}
          onAnalysis={observe}
        />
      )}
    </div>
  );
}

function ManualWorkout(props: Props & { definition: ExerciseDefinition }) {
  const previewArea = useRef<HTMLDivElement>(null);
  useCameraLayout(previewArea, props.onCameraHeight);
  const config = defaultWorkoutConfig(props.exercise, props.block);
  const [phase, setPhase] = useState<'setup' | 'active' | 'rest' | 'complete'>('setup');
  const [amount, setAmount] = useState(0),
    [elapsed, setElapsed] = useState(0),
    [paused, setPaused] = useState(false);
  const [sets, setSets] = useState<WorkoutSetRecord[]>([]),
    [rest, setRest] = useState(0);
  const [notice, setNotice] = useState(''),
    [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const previewRequest = useRef<AbortController | null>(null);
  const [armMode, setArmMode] = useState<ArmMode | undefined>(
    props.block?.armMode ?? props.initialArmMode,
  );
  const video = useRef<HTMLVideoElement>(null),
    owned = useRef<MediaStream | null>(null);
  const active = useRef<{ id: string; startedAt: string; elapsed: number; owner?: string } | null>(
    null,
  );
  const restUntil = useRef(0);
  const run = useRef(''),
    completedReps = useRef(props.initialReps ?? 0),
    completedHolds = useRef((props.initialHoldSeconds ?? 0) * 1000);
  const current = useRef({ props, phase, amount, sets, paused, armMode });
  current.current = { props, phase, amount, sets, paused, armMode };
  const timed = props.definition.targetUnit === 'seconds';
  const checkpointKey = props.historyUserId
    ? `geez-squad:manual:v2:${props.historyUserId}:${props.classId ?? 'practice'}:${props.block?.id ?? props.exercise}`
    : '';
  const persist = useRef<() => void>(() => {});
  useEffect(() => {
    run.current = props.runId ?? crypto.randomUUID();
  }, [props.runId]);
  useEffect(() => {
    if (video.current) video.current.srcObject = props.stream ?? preview;
  }, [props.stream, preview]);
  function result(): WorkoutSetRecord | null {
    const a = active.current;
    if (!a) return null;
    const c = current.current,
      duration = Math.floor(a.elapsed);
    return {
      schemaVersion: 2,
      runId: run.current,
      blockId: c.props.block?.id ?? null,
      clientId: a.id,
      classId: c.props.classId ?? null,
      revision: c.props.revision ?? 0,
      exercise: c.props.exercise,
      ruleVersion: 'manual-v2',
      measurementSource: timed ? 'timer' : 'manual',
      targetUnit: timed ? 'seconds' : 'reps',
      loadBasis: c.props.block?.loadBasis ?? null,
      armMode: c.armMode ?? null,
      setNumber: c.sets.length + 1,
      target: config.target,
      reps: timed ? 0 : c.amount,
      holdMs: timed ? duration : 0,
      activeMs: duration,
      trackedMs: 0,
      formScore: null,
      qualityScore: null,
      rangeDegrees: null,
      repSeconds: null,
      confidence: null,
      rejectedReps: 0,
      loadKg: config.loadKg,
      completed: (timed ? duration / 1000 : c.amount) >= config.target,
      startedAt: a.startedAt,
      endedAt: new Date().toISOString(),
    };
  }
  persist.current = () => {
    if (!checkpointKey || !props.historyUserId) return;
    const record = result();
    const checkpoint: RunCheckpoint = {
      version: 2,
      owner: props.historyUserId,
      exercise: props.exercise,
      classId: props.classId ?? null,
      revision: props.revision ?? 0,
      runId: run.current,
      blockId: props.block?.id ?? null,
      reps: completedReps.current + (timed ? 0 : current.current.amount),
      holdMs: completedHolds.current + (timed ? (active.current?.elapsed ?? 0) : 0),
      config: { ...config, armMode: current.current.armMode },
      completedSets: current.current.sets.length,
      records: current.current.sets,
      unfinished: record ?? undefined,
      updatedAt: Date.now(),
      restUntil: restUntil.current,
      saveConsented: !!active.current?.owner && active.current.owner === props.saveForUser,
    };
    try {
      localStorage.setItem(checkpointKey, JSON.stringify(checkpoint));
    } catch {
      /* Explicit saves remain queued by account. */
    }
  };
  useEffect(() => {
    if (!checkpointKey || !props.historyUserId) return;
    const restored = readRunCheckpoint(
      checkpointKey,
      props.historyUserId,
      props.exercise,
      props.classId ?? null,
      props.revision ?? 0,
    );
    if (!restored) return;
    run.current = restored.runId;
    if (restored.config.armMode && Object.hasOwn(armModeLabels, restored.config.armMode))
      setArmMode(restored.config.armMode);
    const records = (Array.isArray(restored.records) ? restored.records : [])
      .flatMap((r) => {
        const parsed = workoutSetSchema.safeParse(r);
        return parsed.success &&
          parsed.data.exercise === props.exercise &&
          parsed.data.classId === (props.classId ?? null) &&
          parsed.data.revision === (props.revision ?? 0)
          ? [parsed.data]
          : [];
      })
      .slice(0, 10);
    const unfinished = workoutSetSchema.safeParse(restored.unfinished);
    if (
      unfinished.success &&
      unfinished.data.exercise === props.exercise &&
      unfinished.data.classId === (props.classId ?? null) &&
      unfinished.data.revision === (props.revision ?? 0)
    ) {
      if (!records.some((r) => r.clientId === unfinished.data.clientId))
        records.push(unfinished.data);
      if (props.saveForUser && restored.saveConsented)
        void saveWorkoutSet(props.saveForUser, unfinished.data).catch(() => {});
    }
    completedReps.current = Math.max(props.initialReps ?? 0, restored.reps);
    completedHolds.current = Math.max((props.initialHoldSeconds ?? 0) * 1000, restored.holdMs);
    setSets(records);
    setAmount(0);
    setElapsed(0);
    if (records.length >= config.sets) setPhase('complete');
    else if (records.length) {
      setPhase('rest');
      restUntil.current = Number.isFinite(restored.restUntil) ? restored.restUntil! : 0;
      setRest(Math.max(0, restUntil.current - Date.now()));
    }
    setNotice('Confirmed results restored. Interrupted activity is kept as a partial set.');
    current.current = { ...current.current, sets: records, amount: 0 };
    persist.current();
  }, [checkpointKey]);
  const finalize = useRef<() => void>(() => {});
  finalize.current = () => {
    const record = result();
    persist.current();
    const owner = active.current?.owner;
    active.current = null;
    if (record && record.activeMs > 0 && owner && owner === props.saveForUser)
      void saveWorkoutSet(owner, record).catch(() => {});
  };
  useEffect(() => {
    const onHide = () => {
      finalize.current();
      setPhase('setup');
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      finalize.current();
      previewRequest.current?.abort();
      owned.current?.getTracks().forEach((t) => t.stop());
      window.removeEventListener('pagehide', onHide);
    };
  }, []);
  useEffect(() => {
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(),
        dt = now - last;
      last = now;
      const c = current.current,
        a = active.current;
      if (c.phase === 'rest') setRest(Math.max(0, restUntil.current - Date.now()));
      if (document.hidden) return;
      if (a && c.phase === 'active' && !c.props.paused && !c.paused && dt <= 1000) {
        a.elapsed += dt;
        setElapsed(a.elapsed);
        persist.current();
      }
      c.props.onAnalysis?.({
        reps: completedReps.current + (timed || c.phase !== 'active' ? 0 : c.amount),
        holdSeconds: Math.floor(
          (completedHolds.current + (timed && c.phase === 'active' ? (a?.elapsed ?? 0) : 0)) / 1000,
        ),
        score: null,
        confidence: 0,
        phase: c.phase === 'active' ? 'manual tracking' : c.phase,
        cue: 'Your coach observes technique. Record completed movements.',
        armMode: c.armMode,
        angle: null,
        tracked: false,
        ruleVersion: 'manual-v2',
        measurementSource: timed ? 'timer' : 'manual',
        targetUnit: timed ? 'seconds' : 'reps',
      });
    }, 250);
    return () => clearInterval(timer);
  }, [timed]);
  async function finish() {
    const record = result();
    if (!record) return;
    if (!timed && record.reps > Math.max(1, Math.ceil(record.activeMs / 350))) {
      setNotice(
        'Keep the activity timer running while you exercise, then record the completed repetitions.',
      );
      return;
    }
    const owner = active.current?.owner;
    active.current = null;
    completedReps.current += record.reps;
    completedHolds.current += record.holdMs;
    const next = [...sets, record];
    setSets(next);
    restUntil.current = Date.now() + config.rest * 1000;
    current.current = { ...current.current, sets: next, amount: 0 };
    persist.current();
    setPhase(next.length >= config.sets ? 'complete' : 'rest');
    setRest(config.rest * 1000);
    if (next.length >= config.sets) props.onWorkoutComplete?.();
    if (owner && owner === props.saveForUser) {
      try {
        await saveWorkoutSet(owner, record);
        setPending(false);
        setNotice('Workout saved.');
      } catch {
        setPending(true);
        setNotice('Save pending. Retry when connected.');
      }
    } else setNotice('Result recorded on this page.');
  }
  return (
    <section className="manual-workout camera-analyzer" aria-label="Manual workout tracking">
      <div className="manual-camera" ref={previewArea}>
        {props.stream || preview ? (
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            style={{ transform: props.mirror === false ? undefined : 'scaleX(-1)' }}
          />
        ) : (
          <div>
            <strong>{props.definition.name}</strong>
            <p>{props.definition.view}</p>
          </div>
        )}
        {props.sessionCamera ? (
          <button className="button outline" onClick={props.onEnableCamera}>
            Enable class camera
          </button>
        ) : (
          !preview && (
            <button
              className="button outline"
              disabled={previewPending}
              onClick={async () => {
                const request = new AbortController();
                previewRequest.current?.abort();
                previewRequest.current = request;
                setPreviewPending(true);
                try {
                  const media = await requestCamera(
                    {
                      video: true,
                      audio: false,
                    },
                    request.signal,
                  );
                  owned.current = media;
                  setPreview(media);
                } catch {
                  if (!request.signal.aborted)
                    setNotice(
                      'Camera unavailable. Check permission and retry. You can still record your workout.',
                    );
                } finally {
                  if (!request.signal.aborted) setPreviewPending(false);
                }
              }}
            >
              {previewPending ? 'Waiting for camera…' : 'Enable camera preview'}
            </button>
          )
        )}
      </div>
      <div className="manual-instructions">
        <ol>
          {props.definition.instructions.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </div>
      <div className="set-progress">
        <div>
          <strong>
            Set {Math.min(sets.length + 1, config.sets)} of {config.sets}
          </strong>
          <span>
            Target {config.target} {timed ? 'seconds' : 'reps'}
          </span>
        </div>
        {props.exercise === 'curl' && (
          <label>
            Workout mode
            <select
              aria-label="Manual curl mode"
              value={armMode ?? ''}
              disabled={phase !== 'setup' || !!props.block?.armMode}
              onChange={(e) => setArmMode(e.target.value as ArmMode)}
            >
              <option value="">Choose how you will curl</option>
              {Object.entries(armModeLabels).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        {(armMode === 'both' || armMode === 'alternating') && (
          <p>
            Enter completed pairs: one full repetition on each arm. Target {config.target} on each
            arm.{' '}
            {armMode === 'both'
              ? 'Your coach checks that both arms move together.'
              : 'Alternate left and right.'}{' '}
            Per-arm measurements are unavailable in manual mode.
          </p>
        )}
        <strong className="manual-counter">
          {timed ? Math.floor(elapsed / 1000) : amount}
          <small> {timed ? 'seconds' : 'reps'}</small>
        </strong>
        <p>
          Observed activity: {Math.floor(elapsed / 1000)}s ·{' '}
          {timed ? 'Activity timer' : 'Self-reported repetitions'}
        </p>
        {!timed && phase === 'active' && (
          <label>
            {armMode === 'both' || armMode === 'alternating'
              ? 'Completed pairs (one repetition on each arm)'
              : 'Completed repetitions'}
            <input
              aria-label="Manual repetitions"
              type="number"
              min={0}
              max={120}
              value={amount}
              onChange={(e) => setAmount(Math.max(0, Math.min(120, Number(e.target.value))))}
            />
          </label>
        )}
        <div className="set-actions">
          {(phase === 'setup' || phase === 'rest') && (
            <button
              className="button lime"
              disabled={props.paused || rest > 0 || (props.exercise === 'curl' && !armMode)}
              onClick={() => {
                active.current = {
                  id: crypto.randomUUID(),
                  startedAt: new Date().toISOString(),
                  elapsed: 0,
                  owner: props.saveForUser,
                };
                setAmount(0);
                setElapsed(0);
                setPaused(false);
                setPhase('active');
              }}
            >
              {rest > 0 ? `Rest ${Math.ceil(rest / 1000)}s` : 'Start set'}
            </button>
          )}
          {phase === 'rest' && rest > 0 && (
            <button
              className="button outline"
              onClick={() => {
                restUntil.current = 0;
                setRest(0);
              }}
            >
              Skip rest
            </button>
          )}
          {phase === 'active' && (
            <>
              <button className="button outline" onClick={() => setPaused(!paused)}>
                {paused ? 'Resume set' : 'Pause set'}
              </button>
              <button className="button lime" onClick={() => void finish()}>
                Finish set
              </button>
            </>
          )}
          {phase === 'complete' && (
            <>
              <strong>Workout finished · {sets.length} sets recorded</strong>
              <button
                className="button outline"
                onClick={() => {
                  setSets([]);
                  setPhase('setup');
                  current.current = { ...current.current, sets: [], amount: 0 };
                  run.current = crypto.randomUUID();
                  restUntil.current = 0;
                  setRest(0);
                  persist.current();
                }}
              >
                New workout
              </button>
            </>
          )}
        </div>
      </div>
      {notice && (
        <p role="status">
          {notice}{' '}
          {pending && (
            <button
              className="button outline"
              onClick={async () => {
                try {
                  await retryWorkoutSets(props.saveForUser!);
                  setPending(false);
                  setNotice('Workout saved.');
                } catch {
                  setNotice('Save still pending.');
                }
              }}
            >
              Retry saving
            </button>
          )}
        </p>
      )}
    </section>
  );
}
