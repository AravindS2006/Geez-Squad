'use client';
import { initialJointStability, stabilizePoseJoints } from '@/lib/pose-joints';
import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  ScanLine,
  Volume2,
  VolumeX,
  Play,
  Pause,
  CheckCircle2,
  Settings2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { Block, ExerciseId, WorkoutSetRecord } from '@/lib/types';
import {
  initialTrainingMetrics,
  observeTrainingMetrics,
  pauseTrainingMetrics,
  trainingMetricsSummary,
} from '@/lib/training-metrics';
import { saveWorkoutSet, retryWorkoutSets, pendingWorkoutSets } from '@/lib/workout-save';
import {
  analyzePose,
  initialPoseState,
  skeletonConnections,
  type Analysis,
  type Landmark,
  RULE_VERSION,
} from '@/lib/pose-engine';
import { exercises } from '@/lib/catalog';
import { initialPoseOverlay, updatePoseOverlay, type OverlayPoint } from '@/lib/pose-overlay';
import { initialPoseContinuity, validatePoseContinuity } from '@/lib/pose-continuity';
import {
  initialPoseDiagnostics,
  poseDiagnosticReport,
  recordPoseDiagnostics,
} from '@/lib/pose-diagnostics';
import { readBrowserPreference } from '@/lib/browser-preferences';
import {
  defaultWorkoutConfig,
  normalizeWorkoutConfig,
  type WorkoutConfig,
} from '@/lib/workout-config';
import { Modal } from './ui';
import {
  advanceStartCountdown,
  canStartWorkout,
  initialStartCountdown,
  MAX_START_FRAME_GAP_MS,
} from '@/lib/workout-start';
import { workoutSetProgress } from '@/lib/workout-progress';
import { exerciseIds, getExerciseProfile, isHoldExercise } from '@/lib/exercise-profiles';
import {
  beginMovementCalibration,
  advanceMovementCalibration,
  type MovementCalibration,
} from '@/lib/movement-calibration';

const movementSteps = Object.fromEntries(
  exerciseIds.map((id) => {
    const profile = getExerciseProfile(id);
    return [id, [profile.startCue, profile.moveCue, profile.returnCue]];
  }),
) as Record<ExerciseId, [string, string, string]>;

const empty: Analysis = {
  reps: 0,
  holdSeconds: 0,
  score: null,
  confidence: 0,
  phase: 'camera off',
  cue: 'Enable your camera to begin.',
  angle: null,
  tracked: false,
  ruleVersion: RULE_VERSION,
};
export function CameraAnalyzer({
  exercise,
  paused = false,
  revision = 0,
  stream,
  onAnalysis,
  onStream,
  initialReps = 0,
  initialHoldSeconds = 0,
  block,
  sessionCamera = false,
  onEnableCamera,
  saveForUser,
  historyUserId = saveForUser,
  classId = null,
  mirror = true,
  onCameraHeight,
}: {
  exercise: ExerciseId;
  paused?: boolean;
  revision?: number;
  stream?: MediaStream | null;
  onAnalysis?: (a: Analysis) => void;
  onStream?: (s: MediaStream | null) => void;
  initialReps?: number;
  initialHoldSeconds?: number;
  block?: Block;
  sessionCamera?: boolean;
  onEnableCamera?: () => void;
  saveForUser?: string;
  historyUserId?: string;
  classId?: string | null;
  mirror?: boolean;
  onCameraHeight?: (height: number) => void;
}) {
  const cameraView = useRef<HTMLDivElement>(null);
  const displaySize = useRef({ width: 0, height: 0 });
  const video = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    worker = useRef<Worker | null>(null),
    state = useRef(initialPoseState());
  const previewState = useRef(initialPoseState());
  const overlayState = useRef(initialPoseOverlay());
  const continuityState = useRef(initialPoseContinuity());
  const diagnosticBuffer = useRef(initialPoseDiagnostics());
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false);
  const diagnosticsEnabledRef = useRef(false);
  type Mode = 'setup' | 'active' | 'rest' | 'complete';
  type SetResult = {
    number: number;
    amount: number;
    score: number | null;
    range: number;
    tempo: number;
    quality: number | null;
    record?: WorkoutSetRecord;
  };
  const [config, setConfig] = useState(() => defaultWorkoutConfig(exercise, block));
  const [mode, setMode] = useState<Mode>('setup');
  const [completedSets, setCompletedSets] = useState<SetResult[]>([]);
  const [restUntil, setRestUntil] = useState(0);
  const [restLeft, setRestLeft] = useState(0);
  const [localPaused, setLocalPaused] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [showGo, setShowGo] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [countdownPaused, setCountdownPaused] = useState(false);
  const [cueExpanded, setCueExpanded] = useState(false);
  const calibrationRef = useRef<MovementCalibration | null>(null);
  const [calibration, setCalibration] = useState<MovementCalibration | null>(null);
  const [modelVariant, setModelVariant] = useState<'lite' | 'full' | 'heavy'>('heavy');
  const modelVariantRef = useRef(modelVariant);
  modelVariantRef.current = modelVariant;
  const [modelInfo, setModelInfo] = useState({ variant: 'full', delegate: '', fps: 0 });
  const frameStats = useRef({ frames: 0, since: 0 });
  const recentInferenceMs = useRef<number[]>([]);
  const [qualityNotice, setQualityNotice] = useState('');
  const frameRequest = useRef<number | null>(null);
  const armedRef = useRef(false);
  const armedAt = useRef(0);
  const startClock = useRef(initialStartCountdown());
  const lastCountdownSound = useRef<number | null>(null);
  const lastFrameAt = useRef(0);
  const staleFrame = useRef(false);
  const trackingBackend = useRef('');
  const recoverOnCPU = useRef<(() => void) | null>(null);
  const initDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef<Mode>('setup');
  const configRef = useRef(config);
  const baseline = useRef({ reps: initialReps, holdMs: initialHoldSeconds * 1000 });
  const completedRef = useRef<SetResult[]>([]);
  const samples = useRef({ count: 0, total: 0 });
  const metrics = useRef(initialTrainingMetrics(initialReps));
  const setStartedAt = useRef('');
  const lastObservedAt = useRef('');
  const activeSet = useRef<{
    clientId: string;
    exercise: ExerciseId;
    revision: number;
    classId: string | null;
    owner?: string;
  } | null>(null);
  const saveOwner = useRef(saveForUser);
  const sessionContext = useRef({ classId, revision });
  sessionContext.current = { classId, revision };
  const retryOwner = useRef(historyUserId);
  retryOwner.current = historyUserId;
  saveOwner.current = saveForUser;
  const [saveMessage, setSaveMessage] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const soundContext = useRef<AudioContext | null>(null);
  const lastVideoTime = useRef(-1);
  const lastCaptureAt = useRef(0);
  const jointStability = useRef(initialJointStability());
  configRef.current = config;
  const ownStream = useRef<MediaStream | null>(null),
    currentStream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    inFlight = useRef(false),
    generation = useRef(0);
  const exerciseRef = useRef(exercise),
    pausedRef = useRef(paused),
    analysisCallback = useRef(onAnalysis),
    streamCallback = useRef(onStream),
    voiceRef = useRef(false),
    lastSpoken = useRef({ text: '', at: 0 });
  const tally = useRef({ reps: initialReps, holdMs: initialHoldSeconds * 1000 });
  const [analysis, setAnalysis] = useState(empty),
    [status, setStatus] = useState('off'),
    [error, setError] = useState(''),
    [voice, setVoice] = useState(false);
  exerciseRef.current = exercise;
  pausedRef.current = paused || localPaused;
  analysisCallback.current = onAnalysis;
  streamCallback.current = onStream;
  voiceRef.current = voice;
  function stop() {
    overlayState.current = initialPoseOverlay();
    continuityState.current = initialPoseContinuity();
    jointStability.current = initialJointStability();
    calibrationRef.current = null;
    setCalibration(null);
    cancelStart();
    if (initDeadline.current) clearTimeout(initDeadline.current);
    initDeadline.current = null;
    generation.current += 1;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (frameRequest.current !== null)
      video.current?.cancelVideoFrameCallback?.(frameRequest.current);
    frameRequest.current = null;
    worker.current?.terminate();
    worker.current = null;
    recoverOnCPU.current = null;
    trackingBackend.current = '';
    inFlight.current = false;
    ownStream.current?.getTracks().forEach((t) => t.stop());
    ownStream.current = null;
    currentStream.current = null;
    if (video.current) video.current.srcObject = null;
    canvas.current?.getContext('2d')?.clearRect(0, 0, canvas.current.width, canvas.current.height);
    streamCallback.current?.(null);
    window.speechSynthesis?.cancel();
  }
  function announce(text: string, force = false, urgent = false) {
    if (!voiceRef.current || !window.speechSynthesis) return;
    if (
      !force &&
      (Date.now() - lastSpoken.current.at < (urgent ? 2000 : 7000) ||
        lastSpoken.current.text === text)
    )
      return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    lastSpoken.current = { text, at: Date.now() };
  }
  function signalRep() {
    const context = soundContext.current;
    if (!voiceRef.current || !context || context.state !== 'running') return;
    const oscillator = context.createOscillator(),
      gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.frequency.value = 720;
    gain.gain.setValueAtTime(0.06, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.1);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.1);
  }
  function recordSet() {
    const active = activeSet.current;
    if (!active) return null;
    activeSet.current = null;
    const amount = Math.floor(
      workoutSetProgress(
        active.exercise,
        tally.current.reps,
        tally.current.holdMs,
        baseline.current,
      ),
    );
    const measured = trainingMetricsSummary(metrics.current);
    const record: WorkoutSetRecord = {
      clientId: active.clientId,
      classId: active.classId,
      revision: active.revision,
      exercise: active.exercise,
      ruleVersion: RULE_VERSION,
      setNumber: completedRef.current.length + 1,
      target: configRef.current.target,
      reps: Math.max(0, tally.current.reps - baseline.current.reps),
      holdMs: Math.max(0, Math.floor(tally.current.holdMs - baseline.current.holdMs)),
      activeMs: measured.activeMs,
      trackedMs: measured.trackedMs,
      formScore: measured.formScore,
      qualityScore: measured.qualityScore,
      rangeDegrees: measured.rangeDegrees,
      repSeconds: measured.repSeconds,
      confidence: measured.confidence,
      rejectedReps: measured.rejectedReps,
      loadKg: configRef.current.loadKg,
      completed: amount >= configRef.current.target,
      startedAt: setStartedAt.current,
      endedAt: lastObservedAt.current || setStartedAt.current,
    };
    return {
      record,
      amount,
      owner: saveOwner.current === active.owner ? active.owner : undefined,
      measured,
    };
  }
  function finishSet(result: Analysis) {
    if (modeRef.current !== 'active') return;
    const snapshot = recordSet();
    if (!snapshot) return;
    const { record, amount, owner, measured } = snapshot;
    setShowGo(false);
    const entry = {
      number: completedRef.current.length + 1,
      amount,
      score: samples.current.count
        ? Math.round(samples.current.total / samples.current.count)
        : null,
      range: result.rangeDegrees ?? 0,
      tempo: result.lastRepSeconds ?? 0,
      quality: measured.qualityScore,
      record: owner ? record : undefined,
    };
    completedRef.current = [...completedRef.current, entry];
    setCompletedSets(completedRef.current);
    if (owner) {
      setSaveMessage('Saving workout…');
      void saveWorkoutSet(owner, record)
        .then(() => {
          const pending = pendingWorkoutSets(owner) > 0;
          setSaveFailed(pending);
          setSaveMessage(
            pending ? 'Another workout save is pending. Retry when connected.' : 'Workout saved',
          );
        })
        .catch(() => {
          setSaveFailed(true);
          setSaveMessage('Workout save pending. Retry when connected.');
        });
    }
    const nextMode = completedRef.current.length >= configRef.current.sets ? 'complete' : 'rest';
    modeRef.current = nextMode;
    setMode(nextMode);
    setLocalPaused(false);
    const until = Date.now() + configRef.current.rest * 1000;
    setRestUntil(until);
    setRestLeft(configRef.current.rest);
    announce(
      nextMode === 'complete'
        ? 'Workout complete. Well done. Take a recovery break.'
        : `Set finished. Rest for ${configRef.current.rest} seconds.`,
      true,
    );
  }
  function cancelStart() {
    if (armedRef.current) window.speechSynthesis?.cancel();
    armedRef.current = false;
    startClock.current = initialStartCountdown();
    lastCountdownSound.current = null;
    setArmed(false);
    setCountdown(null);
    setCountdownPaused(false);
    setShowGo(false);
  }
  function startSet() {
    calibrationRef.current = null;
    setCalibration(null);
    if (
      pausedRef.current ||
      document.hidden ||
      status !== 'ready' ||
      armedRef.current ||
      (modeRef.current !== 'setup' && modeRef.current !== 'rest') ||
      (modeRef.current === 'rest' && Date.now() < restUntil)
    )
      return;
    previewState.current = initialPoseState();
    startClock.current = initialStartCountdown();
    armedAt.current = performance.now();
    armedRef.current = true;
    lastCountdownSound.current = null;
    setCountdown(null);
    setCountdownPaused(false);
    setArmed(true);
    setSettingsOpen(false);
    if (voiceRef.current && window.AudioContext) {
      soundContext.current ??= new AudioContext();
      void soundContext.current.resume();
    }
    announce(
      'Step back into view and hold your starting position. Your set will start after the countdown.',
      true,
    );
  }
  function activateSet(timestamp: number) {
    if (!armedRef.current || pausedRef.current || document.hidden) return;
    baseline.current = { reps: tally.current.reps, holdMs: tally.current.holdMs };
    metrics.current = initialTrainingMetrics(tally.current.reps, timestamp);
    setStartedAt.current = new Date().toISOString();
    lastObservedAt.current = setStartedAt.current;
    activeSet.current = {
      clientId: crypto.randomUUID(),
      exercise: exerciseRef.current,
      ...sessionContext.current,
      owner: saveOwner.current,
    };
    const preview = previewState.current;
    // The countdown already observed a stable starting pose. Preserve that readiness
    // so the first movement after Go is counted, without importing rehearsal reps.
    state.current = {
      ...initialPoseState(),
      ...tally.current,
      stage: isHoldExercise(exerciseRef.current) ? 'seek' : 'ready',
      side: preview.side,
      sideStartSeen: [...preview.sideStartSeen],
      sideStartSource: [...preview.sideStartSource],
      geometrySource: preview.geometrySource,
      sideWorldSegments: preview.sideWorldSegments.map((lengths) =>
        lengths ? [...lengths] : null,
      ) as [number[] | null, number[] | null],
      lastRawSignal: preview.lastRawSignal,
      smoothAngle: preview.smoothAngle,
      candidate: preview.candidate,
      candidateSince: preview.candidateSince,
      lastTimestamp: timestamp,
      previousHoldValid: isHoldExercise(exerciseRef.current),
    };
    cancelStart();
    samples.current = { count: 0, total: 0 };
    modeRef.current = 'active';
    setMode('active');
    setShowGo(true);
    setLocalPaused(false);
    signalRep();
    announce('Go. Your set has started. Move under control.', true);
  }
  function invalidateTracking(cue: string, preserveContinuity = false) {
    pauseTrainingMetrics(metrics.current);
    overlayState.current = initialPoseOverlay();
    if (!preserveContinuity) continuityState.current = initialPoseContinuity();
    jointStability.current = initialJointStability();
    calibrationRef.current = null;
    setCalibration(null);
    canvas.current?.getContext('2d')?.clearRect(0, 0, canvas.current.width, canvas.current.height);
    state.current = { ...initialPoseState(), ...tally.current };
    previewState.current = initialPoseState();
    startClock.current = initialStartCountdown();
    lastCountdownSound.current = null;
    setCountdown(null);
    setCountdownPaused(false);
    const unavailable = {
      ...empty,
      reps: tally.current.reps,
      holdSeconds: Math.floor(tally.current.holdMs / 1000),
      phase: 'camera paused',
      cue,
    };
    setAnalysis(unavailable);
    analysisCallback.current?.(unavailable);
  }
  async function retrySaving() {
    if (!retryOwner.current || saving) return;
    setSaving(true);
    try {
      await retryWorkoutSets(retryOwner.current);
      for (const entry of completedRef.current)
        if (entry.record) await saveWorkoutSet(retryOwner.current, entry.record);
      setSaveFailed(false);
      setSaveMessage('Workout saved');
    } catch {
      setSaveFailed(true);
      setSaveMessage('Workout save pending. Check your connection and retry.');
    } finally {
      setSaving(false);
    }
  }
  useEffect(
    () => () => {
      const unfinished = recordSet();
      if (unfinished?.owner && unfinished.record.activeMs > 0)
        void saveWorkoutSet(unfinished.owner, unfinished.record).catch(() => {});
      stop();
      void soundContext.current?.close();
    },
    [],
  ); // All device and worker resources are owned by this component.
  useEffect(() => {
    const unfinished = recordSet();
    if (unfinished?.owner && unfinished.record.activeMs > 0)
      void saveWorkoutSet(unfinished.owner, unfinished.record).catch(() => {
        setSaveFailed(true);
        setSaveMessage('Workout save pending. Retry when connected.');
      });
    tally.current = { reps: initialReps, holdMs: initialHoldSeconds * 1000 };
    state.current = { ...initialPoseState(), ...tally.current };
    previewState.current = initialPoseState();
    baseline.current = { reps: initialReps, holdMs: initialHoldSeconds * 1000 };
    cancelStart();
    modeRef.current = 'setup';
    setMode('setup');
    setLocalPaused(false);
    completedRef.current = [];
    setCompletedSets([]);
    let saved: Partial<WorkoutConfig> = {};
    try {
      saved = JSON.parse(readBrowserPreference(`geez-squad-workout-v3-${exercise}`) || '{}');
    } catch {}
    setConfig(
      normalizeWorkoutConfig(exercise, {
        ...saved,
        ...(block
          ? { sets: block.sets, target: block.reps, rest: block.rest, loadKg: block.loadKg ?? null }
          : {}),
      }),
    );
    setAnalysis({ ...empty, reps: initialReps, holdSeconds: initialHoldSeconds });
  }, [classId, exercise, revision, block?.sets, block?.reps, block?.rest, block?.loadKg]);
  useEffect(() => {
    const onPageHide = () => {
      const unfinished = recordSet();
      if (unfinished?.owner && unfinished.record.activeMs > 0)
        void saveWorkoutSet(unfinished.owner, unfinished.record).catch(() => {});
      modeRef.current = 'setup';
      setMode('setup');
      stop();
      setStatus('off');
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);
  useEffect(() => {
    const view = cameraView.current;
    if (!view) return;
    const update = () => {
      const { width, height } = view.getBoundingClientRect();
      displaySize.current = { width, height };
      onCameraHeight?.(height);
    };
    const observer = new ResizeObserver(update);
    observer.observe(view);
    update();
    return () => observer.disconnect();
  }, [onCameraHeight]);
  useEffect(() => {
    if (mode !== 'rest') return;
    const tick = () => setRestLeft(Math.max(0, Math.ceil((restUntil - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [mode, restUntil]);
  useEffect(() => {
    if (paused || localPaused) {
      cancelStart();
      invalidateTracking('Tracking paused. Resume and return to your starting position.');
      window.speechSynthesis?.cancel();
    }
  }, [paused, localPaused]);
  useEffect(() => {
    if (historyUserId && pendingWorkoutSets(historyUserId)) {
      setSaveFailed(true);
      setSaveMessage('Unsaved workout summaries are available. Retry saving.');
    }
  }, [historyUserId]);
  useEffect(() => {
    if (!showGo) return;
    const timer = setTimeout(() => setShowGo(false), 1000);
    return () => clearTimeout(timer);
  }, [showGo]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        cancelStart();
        invalidateTracking(
          'Tracking paused while this tab is hidden. Return to the meeting to continue.',
        );
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  useEffect(() => {
    if (status !== 'ready') return;
    const watchdog = setInterval(() => {
      if (document.hidden || pausedRef.current) return;
      const gap = performance.now() - lastFrameAt.current;
      // A GPU can initialize successfully yet block synchronously during
      // inference. Replace that worker once rather than waiting indefinitely.
      if (trackingBackend.current === 'GPU' && inFlight.current && gap > 5000) {
        recoverOnCPU.current?.();
        return;
      }
      if (staleFrame.current || gap <= MAX_START_FRAME_GAP_MS) return;
      staleFrame.current = true;
      invalidateTracking(
        'Camera frames paused. Wait for tracking to recover or restart camera analysis.',
      );
    }, 250);
    return () => clearInterval(watchdog);
  }, [status]);
  useEffect(() => {
    if (stream && stream !== currentStream.current) void start(stream);
    if (!stream && currentStream.current && !ownStream.current) {
      stop();
      setStatus('off');
      setAnalysis({
        ...empty,
        reps: tally.current.reps,
        holdSeconds: Math.floor(tally.current.holdMs / 1000),
      });
    }
  }, [stream]);
  async function start(external?: MediaStream) {
    stop();
    const run = generation.current;
    state.current = { ...initialPoseState(), ...tally.current };
    previewState.current = initialPoseState();
    lastVideoTime.current = -1;
    setError('');
    setStatus('loading');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.Worker || !window.createImageBitmap)
        throw new Error(
          'Camera analysis is not supported here. Use a current Chrome, Edge, or Safari browser over HTTPS.',
        );
      const camera =
        external ??
        (await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
            facingMode: 'user',
          },
          audio: false,
        }));
      if (generation.current !== run) {
        if (!external) camera.getTracks().forEach((t) => t.stop());
        return;
      }
      if (!external) ownStream.current = camera;
      currentStream.current = camera;
      streamCallback.current?.(camera);
      if (!video.current) return;
      video.current.srcObject = camera;
      await video.current.play();
      if (generation.current !== run) return;
      const launchWorker = (cpuOnly = false) => {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        if (frameRequest.current !== null)
          video.current?.cancelVideoFrameCallback?.(frameRequest.current);
        frameRequest.current = null;
        worker.current?.terminate();
        inFlight.current = false;
        lastVideoTime.current = -1;
        lastCaptureAt.current = 0;
        trackingBackend.current = '';
        recentInferenceMs.current = [];
        if (cpuOnly) {
          recoverOnCPU.current = null;
          invalidateTracking('Restarting tracking using CPU. Hold your starting position.');
          setStatus('loading');
        }
        const task = new Worker('/pose-worker.js');
        worker.current = task;
        task.onerror = () => {
          if (generation.current === run && worker.current === task) {
            stop();
            setStatus('off');
            setError('Camera analysis could not start. Retry in a supported browser.');
          }
        };
        task.onmessage = ({ data }) => {
          if (generation.current !== run || worker.current !== task) {
            data.bitmap?.close();
            return;
          }
          if (data.type === 'backend') {
            trackingBackend.current = data.delegate;
            if (data.delegate === 'CPU') recoverOnCPU.current = null;
            setModelInfo((previous) => ({ ...previous, delegate: data.delegate }));
            invalidateTracking('Tracking recovered using CPU. Return to your starting position.');
            return;
          }
          if (data.type === 'error') {
            stop();
            setStatus('off');
            setError(data.message);
            return;
          }
          if (data.type === 'ready') {
            if (initDeadline.current) clearTimeout(initDeadline.current);
            initDeadline.current = null;
            lastFrameAt.current = performance.now();
            staleFrame.current = false;
            trackingBackend.current = data.delegate;
            if (data.delegate === 'CPU') recoverOnCPU.current = null;
            setStatus('ready');
            frameStats.current = { frames: 0, since: performance.now() };
            setModelInfo({
              variant: data.variant ?? modelVariantRef.current,
              delegate: data.delegate ?? '',
              fps: 0,
            });
            const captureFrame = async () => {
              const v = video.current;
              if (
                !v ||
                v.readyState < 2 ||
                inFlight.current ||
                pausedRef.current ||
                document.hidden ||
                performance.now() - lastCaptureAt.current < 50 ||
                lastVideoTime.current === v.currentTime
              )
                return;
              lastVideoTime.current = v.currentTime;
              const timestamp = performance.now();
              // Advance the sampling clock rather than resetting it to every
              // camera frame. A 24 FPS camera would otherwise be halved to
              // 12 FPS by a strict 50 ms gap; this keeps the average at 20 FPS.
              lastCaptureAt.current =
                timestamp - lastCaptureAt.current > 100 ? timestamp : lastCaptureAt.current + 50;
              inFlight.current = true;
              try {
                const bitmap = await createImageBitmap(v);
                if (generation.current !== run || worker.current !== task) {
                  bitmap.close();
                  return;
                }
                task.postMessage(
                  {
                    type: 'frame',
                    bitmap,
                    presentFrame: true,
                    timestamp,
                    // A camera can rotate or change resolution while capture
                    // is pending. Geometry must describe this captured image.
                    width: bitmap.width,
                    height: bitmap.height,
                  },
                  [bitmap],
                );
              } catch {
                if (generation.current === run && worker.current === task) inFlight.current = false;
              }
            };
            const v = video.current;
            if (v?.requestVideoFrameCallback) {
              const onFrame = () => {
                if (generation.current !== run || worker.current !== task) return;
                frameRequest.current = v.requestVideoFrameCallback(onFrame);
                void captureFrame();
              };
              frameRequest.current = v.requestVideoFrameCallback(onFrame);
            } else timer.current = setInterval(() => void captureFrame(), 33);
          }
          if (data.type === 'result') {
            inFlight.current = false;
            const now = performance.now();
            if (Number.isFinite(data.inferenceMs) && data.inferenceMs >= 0) {
              recentInferenceMs.current.push(data.inferenceMs);
              if (recentInferenceMs.current.length > 20) recentInferenceMs.current.shift();
            }
            const meanInferenceMs =
              recentInferenceMs.current.reduce((sum, ms) => sum + ms, 0) /
              recentInferenceMs.current.length;
            // Heavy at 6–9 FPS can miss short exercise endpoints despite clearer
            // individual frames. Keep it only when it meets a 100 ms frame budget.
            if (
              modelVariantRef.current !== 'lite' &&
              recentInferenceMs.current.length >= (modelVariantRef.current === 'heavy' ? 5 : 20) &&
              meanInferenceMs > 100
            ) {
              data.bitmap?.close();
              const next = modelVariantRef.current === 'heavy' ? 'full' : 'lite';
              modelVariantRef.current = next;
              setModelVariant(next);
              setQualityNotice(
                next === 'full'
                  ? 'Switched to the Full model for smoother real-time movement tracking. Your completed reps are retained.'
                  : 'Switched to Lite to keep up with movement on this device. Use good lighting and confirm technique with your coach. Your completed reps are retained.',
              );
              invalidateTracking(
                'Hold your starting position while tracking adapts to this device.',
              );
              setStatus('loading');
              launchWorker(trackingBackend.current === 'CPU');
              return;
            }
            if (
              document.hidden ||
              pausedRef.current ||
              !Number.isFinite(data.timestamp) ||
              now - data.timestamp > MAX_START_FRAME_GAP_MS ||
              data.timestamp > now
            ) {
              staleFrame.current = true;
              invalidateTracking('Waiting for fresh camera frames before tracking continues.');
              data.bitmap?.close();
              return;
            }
            lastFrameAt.current = data.timestamp;
            staleFrame.current = false;
            frameStats.current.frames++;
            if (now - frameStats.current.since >= 1000) {
              const fps = Math.round(
                (frameStats.current.frames * 1000) / (now - frameStats.current.since),
              );
              setModelInfo((previous) => ({ ...previous, fps }));
              frameStats.current = { frames: 0, since: now };
            }
            const activeSet = modeRef.current === 'active';
            const observation = validatePoseContinuity(
              continuityState.current,
              data.poses,
              data.worldPoses,
              data.timestamp,
              data.width,
              data.height,
            );
            if (observation.resetRequired)
              invalidateTracking('Body tracking changed. Return to your starting position.', true);
            const stable = stabilizePoseJoints(
              jointStability.current,
              observation.poses,
              observation.worldPoses,
              data.timestamp,
              data.width,
              data.height,
            );
            const result = analyzePose(
              stable.poses,
              exerciseRef.current,
              activeSet ? state.current : previewState.current,
              data.timestamp,
              data.width,
              data.height,
              pausedRef.current,
              configRef.current,
              stable.worldPoses,
            );
            if (observation.rejected) {
              result.phase = 'reacquiring body tracking';
              result.cue =
                observation.reason === 'landmark-identity'
                  ? 'Left/right tracking is uncertain. Hold your position while tracking settles.'
                  : 'Body position changed abruptly. Hold your position while tracking settles.';
            }
            if (calibrationRef.current) {
              const measured = advanceMovementCalibration(
                calibrationRef.current,
                result,
                data.timestamp,
                exerciseRef.current,
              );
              calibrationRef.current = measured;
              setCalibration(measured);
              if (measured.phase === 'complete' && measured.range) {
                updateConfig(measured.range);
                calibrationRef.current = null;
                previewState.current = initialPoseState();
              } else if (measured.phase === 'failed') calibrationRef.current = null;
            }
            const continuing = armedRef.current && startClock.current.acquired;
            const ready =
              canStartWorkout(result, exerciseRef.current, configRef.current, continuing) &&
              (continuing ||
                isHoldExercise(exerciseRef.current) ||
                previewState.current.stage === 'ready');
            if (armedRef.current) {
              startClock.current = advanceStartCountdown(
                startClock.current,
                ready && data.timestamp >= armedAt.current,
                data.timestamp,
              );
              const remaining = !startClock.current.acquired
                ? null
                : Math.ceil(startClock.current.remainingMs / 1000);
              setCountdown(remaining);
              setCountdownPaused(startClock.current.invalidSince !== null);
              if (remaining !== null && remaining > 0 && remaining !== lastCountdownSound.current) {
                signalRep();
                lastCountdownSound.current = remaining;
              }
              if (ready && startClock.current.remainingMs === 0) activateSet(data.timestamp);
            }
            if (activeSet) {
              observeTrainingMetrics(
                metrics.current,
                result,
                data.timestamp,
                state.current.feedbackUntil,
              );
              lastObservedAt.current = new Date().toISOString();
              const measured = trainingMetricsSummary(metrics.current);
              result.trackingCoverage = measured.trackingCoverage;
              result.rejectedReps = measured.rejectedReps;
              if (result.reps > tally.current.reps) signalRep();
              tally.current = { reps: state.current.reps, holdMs: state.current.holdMs };
              if (result.score !== null) {
                samples.current.count++;
                samples.current.total += result.score;
              }
              const progress = workoutSetProgress(
                exerciseRef.current,
                result.reps,
                tally.current.holdMs,
                baseline.current,
              );
              if (progress >= configRef.current.target) finishSet(result);
            } else {
              result.reps = tally.current.reps;
              result.holdSeconds = Math.floor(tally.current.holdMs / 1000);
              result.score = null;
              if (armedRef.current) {
                result.phase = !startClock.current.acquired
                  ? 'getting into position'
                  : 'starting countdown';
                result.cue = ready
                  ? 'Hold your starting position through the countdown.'
                  : result.tracked
                    ? `${movementSteps[exerciseRef.current][0]} Hold this starting position for the countdown.`
                    : result.cue;
              } else if (result.tracked && modeRef.current === 'rest') {
                result.phase = 'resting';
              } else if (result.tracked && modeRef.current === 'complete') {
                result.phase = 'workout complete';
              } else if (result.tracked && modeRef.current === 'setup' && ready) {
                result.phase = 'ready to start';
              }
            }
            setAnalysis(result);
            analysisCallback.current?.(result);
            if (diagnosticsEnabledRef.current)
              recordPoseDiagnostics(diagnosticBuffer.current, {
                timestamp: data.timestamp,
                exercise: exerciseRef.current,
                config: configRef.current,
                width: data.width,
                height: data.height,
                model: modelVariantRef.current,
                backend: trackingBackend.current,
                inferenceMs: data.inferenceMs,
                mode: modeRef.current,
                stage: (activeSet ? state.current : previewState.current).stage,
                continuity: observation.reason ?? 'accepted',
                analysis: result,
                poses: observation.rawPoses,
                worldPoses: observation.rawWorldPoses,
              });
            // Exercise readiness must not erase the entire body visualization.
            // Scoring still uses the original, strictly gated model measurements.
            draw(
              updatePoseOverlay(
                overlayState.current,
                stable.poses,
                data.timestamp,
                data.width,
                data.height,
              ),
              data.width,
              data.height,
              data.bitmap,
            );
            if (modeRef.current === 'setup' || modeRef.current === 'active')
              announce(
                result.cue,
                false,
                !result.tracked ||
                  result.cue.startsWith('Rep not counted') ||
                  (result.score !== null && result.score < 75),
              );
          }
        };
        initDeadline.current = setTimeout(
          () => {
            if (generation.current !== run || worker.current !== task) return;
            if (!cpuOnly) {
              setQualityNotice('GPU initialization took too long. Tracking is restarting on CPU.');
              launchWorker(true);
              return;
            }
            stop();
            setStatus('off');
            setError(
              'Pose tracking took too long to load. Check your connection and retry camera analysis.',
            );
          },
          cpuOnly ? 45000 : 15000,
        );
        task.postMessage({ type: 'init', variant: modelVariantRef.current, cpuOnly });
      };
      recoverOnCPU.current = () => launchWorker(true);
      launchWorker();
    } catch (err) {
      if (generation.current !== run) return;
      stop();
      setStatus('off');
      const name = err instanceof Error ? err.name : '';
      setError(
        name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in your browser, then retry.'
          : name === 'NotFoundError'
            ? 'No camera was found. Connect a camera and retry.'
            : name === 'NotReadableError'
              ? 'Your camera may be in use by another app. Close it and retry.'
              : err instanceof Error
                ? err.message
                : 'Could not start your camera.',
      );
    }
  }
  function draw(
    landmarks: (OverlayPoint | null)[],
    width: number,
    height: number,
    bitmap?: ImageBitmap,
  ) {
    try {
      const c = canvas.current;
      if (!c) return;
      if (c.width !== width) c.width = width;
      if (c.height !== height) c.height = height;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      // Present the analyzed image and its landmarks together. A separate live
      // video can otherwise move ahead of inference and make joints look misplaced.
      if (bitmap) ctx.drawImage(bitmap, 0, 0, width, height);
      // Camera resolution and visible tile size differ, especially for portrait
      // phone feeds. Keep markers readable without changing landmark positions.
      const scale =
        Math.min(1, displaySize.current.width / width, displaySize.current.height / height) || 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.fillStyle = '#cbff65';
      for (const [a, b] of skeletonConnections) {
        const start = landmarks[a],
          end = landmarks[b];
        if (!start || !end) continue;
        ctx.globalAlpha = Math.min(start.opacity, end.opacity);
        ctx.beginPath();
        ctx.moveTo(start.x * width, start.y * height);
        ctx.lineTo(end.x * width, end.y * height);
        ctx.strokeStyle = '#10171ddd';
        ctx.lineWidth = 4 / scale;
        ctx.stroke();
        ctx.strokeStyle = '#cbff65';
        ctx.lineWidth = 2 / scale;
        ctx.stroke();
      }
      for (const p of landmarks.slice(11)) {
        if (!p) continue;
        ctx.globalAlpha = p.opacity;
        ctx.beginPath();
        ctx.arc(p.x * width, p.y * height, 3 / scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#10171ddd';
        ctx.lineWidth = 1 / scale;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } finally {
      bitmap?.close();
    }
  }
  const definition = exercises.find((e) => e.id === exercise)!;
  const profile = getExerciseProfile(exercise);
  const progress = Math.floor(
    workoutSetProgress(exercise, analysis.reps, tally.current.holdMs, baseline.current),
  );
  const updateConfig = (change: Partial<WorkoutConfig>) => {
    const next = normalizeWorkoutConfig(exerciseRef.current, { ...configRef.current, ...change });
    configRef.current = next;
    setConfig(next);
    try {
      localStorage.setItem(`geez-squad-workout-v3-${exerciseRef.current}`, JSON.stringify(next));
    } catch {}
  };
  const cue =
    calibration?.cue ??
    (paused || localPaused
      ? 'Tracking paused. Take a moment to reset.'
      : armed
        ? countdown === null
          ? analysis.tracked
            ? `${movementSteps[exercise][0]} Hold this starting position.`
            : analysis.cue
          : countdownPaused
            ? 'Countdown paused. Return to your starting position.'
            : `Starting in ${countdown}. Stay in your starting position.`
        : mode === 'rest'
          ? 'Rest, breathe, and prepare for your next set.'
          : mode === 'complete'
            ? 'Your workout is finished. Open settings to review your sets.'
            : status === 'off'
              ? `${definition.instructions[0]} ${definition.instructions[1]}`
              : status === 'loading'
                ? 'Preparing pose tracking. Keep your body in view.'
                : mode === 'setup' && analysis.tracked
                  ? 'Tap Start set, then step back. Wait for Go.'
                  : analysis.cue);
  const currentSet = Math.min(completedSets.length + 1, config.sets);
  return (
    <div className="camera-analyzer meeting-analyzer">
      <div className="camera-view" ref={cameraView} data-mirrored={mirror}>
        <video ref={video} muted playsInline className="camera-video" />
        <canvas ref={canvas} className="pose-canvas" aria-hidden="true" />
        <div className="analyzer-topbar">
          <span className="analyzer-identity">You · {definition.name}</span>
          <button
            className="icon-button analyzer-settings-button"
            title="Workout settings"
            aria-label="Workout settings"
            onClick={() => {
              cancelStart();
              calibrationRef.current = null;
              setCalibration(null);
              setSettingsOpen(true);
            }}
          >
            <Settings2 size={19} />
          </button>
        </div>
        {status === 'off' && (
          <div className="camera-placeholder">
            <div className="camera-icon">
              <Camera size={32} />
            </div>
            <h3>Your workout camera</h3>
            <p>{profile.cameraCue}. Keep your head in view and step back until these joints fit.</p>
            <button
              className="button lime"
              disabled={sessionCamera && !onEnableCamera}
              onClick={() =>
                sessionCamera ? (stream ? void start(stream) : onEnableCamera?.()) : void start()
              }
            >
              <Camera size={17} /> {sessionCamera ? 'Turn on session camera' : 'Enable camera'}
            </button>
            {sessionCamera && <p>Your coach sees the same camera used for tracking.</p>}
          </div>
        )}
        {((armed && countdown !== null) || showGo) && (
          <div className="start-countdown" role="status" aria-label="Set start countdown">
            <span>
              {showGo ? 'Your set has started' : countdownPaused ? 'Countdown paused' : 'Get ready'}
            </span>
            <strong>{showGo ? 'Go' : countdown}</strong>
            <span>
              {showGo
                ? 'Move under control'
                : countdownPaused
                  ? 'Return to your starting position'
                  : 'Stay in position · Starts automatically'}
            </span>
          </div>
        )}
        {status === 'loading' && (
          <div className="camera-loading">
            <span className="spinner" /> Preparing your camera & pose model…
          </div>
        )}
        {status === 'ready' && (
          <>
            <span className="tracking-badge">
              <span className={`status-dot ${analysis.tracked ? '' : 'amber'}`} />
              {paused || localPaused
                ? 'Paused'
                : analysis.tracked
                  ? 'Pose detected'
                  : 'Position camera'}
            </span>
            <div
              className="analysis-strip analyzer-hud"
              role="group"
              aria-label="Live workout scores"
            >
              <div>
                <span>{isHoldExercise(exercise) ? 'Hold time' : 'Total reps'}</span>
                <strong data-testid="cumulative-reps">
                  {isHoldExercise(exercise)
                    ? `${analysis.holdSeconds}s`
                    : String(analysis.reps).padStart(2, '0')}
                </strong>
              </div>
              <div>
                <span>Form estimate</span>
                <strong>
                  {analysis.score === null ? '—' : Math.round(analysis.score)}
                  <small>{analysis.score === null ? '' : '/100'}</small>
                </strong>
              </div>
              <div>
                <span>Movement phase</span>
                <strong className="phase-text">
                  {paused || localPaused
                    ? 'Paused'
                    : armed
                      ? countdown === null
                        ? 'Getting ready'
                        : countdownPaused
                          ? 'Countdown paused'
                          : `Starting in ${countdown}`
                      : mode === 'rest'
                        ? 'Resting'
                        : mode === 'complete'
                          ? 'Complete'
                          : analysis.phase}
                </strong>
              </div>
            </div>
            <div className="camera-bottom">
              <span>
                Set {currentSet} / {config.sets}
              </span>
              <span>{Math.round(analysis.confidence * 100)}% tracking confidence</span>
            </div>
          </>
        )}
      </div>
      <div className="analyzer-footer">
        {saveMessage && (
          <div className={`workout-save-status ${saveFailed ? 'save-pending' : ''}`} role="status">
            <span>{saveMessage}</span>
            {saveFailed && (
              <button disabled={saving} onClick={() => void retrySaving()}>
                {saving ? 'Saving…' : 'Retry saving'}
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className={`cue-card analyzer-cue ${cueExpanded ? 'is-expanded' : ''}`}>
          <ScanLine size={16} aria-hidden="true" />
          <p role="status">{cue}</p>
          <button
            className="icon-button cue-expand"
            aria-label={cueExpanded ? 'Collapse coaching cue' : 'Expand coaching cue'}
            aria-expanded={cueExpanded}
            onClick={() => setCueExpanded(!cueExpanded)}
          >
            {cueExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
        <section className="set-progress analyzer-progress" aria-label="Set progress">
          <div>
            <strong>
              {mode === 'complete' ? 'Workout complete' : `Set ${currentSet} of ${config.sets}`}
            </strong>
            <span>
              {armed
                ? countdownPaused
                  ? 'Return to start position'
                  : 'Wait for Go'
                : mode === 'setup'
                  ? `${config.target} ${isHoldExercise(exercise) ? 'seconds' : 'reps'} · Start when ready`
                  : mode === 'rest'
                    ? `Recovery · ${restLeft}s remaining`
                    : mode === 'complete'
                      ? `${completedSets.length} sets finished`
                      : `${progress} / ${config.target} ${isHoldExercise(exercise) ? 'seconds' : 'reps'}`}
            </span>
          </div>
          <progress
            value={Math.min(progress, config.target)}
            max={config.target}
            aria-label="Current set target"
          />
          <div className="set-actions">
            {!armed && (mode === 'setup' || mode === 'rest') && (
              <button
                className="button lime"
                disabled={
                  paused ||
                  status !== 'ready' ||
                  Boolean(calibrationRef.current) ||
                  (mode === 'rest' && restLeft > 0)
                }
                onClick={startSet}
              >
                <Play size={17} /> {mode === 'rest' ? 'Start next set' : 'Start set'}
              </button>
            )}
            {status === 'ready' && analysis.phase === 'camera paused' && (
              <button
                className="button outline"
                onClick={() => {
                  const shared = ownStream.current
                    ? undefined
                    : (currentStream.current ?? undefined);
                  void start(shared);
                }}
              >
                Retry tracking
              </button>
            )}
            {armed && (
              <button className="button outline" onClick={cancelStart}>
                Cancel start
              </button>
            )}
            {calibrationRef.current && (
              <button
                className="button outline"
                onClick={() => {
                  calibrationRef.current = null;
                  setCalibration(null);
                }}
              >
                Cancel calibration
              </button>
            )}
            {mode === 'rest' && restLeft > 0 && (
              <button
                className="button outline small"
                onClick={() => {
                  setRestUntil(Date.now());
                  setRestLeft(0);
                }}
              >
                Skip rest
              </button>
            )}
            {mode === 'active' && (
              <button
                className="button outline"
                disabled={paused}
                onClick={() => {
                  setLocalPaused(!localPaused);
                  state.current = { ...initialPoseState(), ...tally.current };
                }}
              >
                {localPaused ? <Play size={16} /> : <Pause size={16} />}
                {localPaused ? 'Resume set' : 'Pause set'}
              </button>
            )}
            {mode === 'complete' && (
              <button
                className="button lime"
                onClick={() => {
                  completedRef.current = [];
                  setCompletedSets([]);
                  modeRef.current = 'setup';
                  setMode('setup');
                  baseline.current = {
                    reps: tally.current.reps,
                    holdMs: tally.current.holdMs,
                  };
                }}
              >
                New workout
              </button>
            )}
          </div>
          <div className="analyzer-tools" role="group" aria-label="Pose tracking controls">
            <div>
              <button
                className="icon-button"
                title={voice ? 'Mute voice & rep sound' : 'Enable voice & rep sound'}
                aria-label={voice ? 'Mute voice & rep sound' : 'Enable voice & rep sound'}
                aria-pressed={voice}
                onClick={() => {
                  setVoice(!voice);
                  voiceRef.current = !voice;
                  if (voice) window.speechSynthesis?.cancel();
                  else {
                    if (window.AudioContext) {
                      soundContext.current ??= new AudioContext();
                      void soundContext.current.resume();
                    }
                    announce(analysis.cue, true);
                  }
                }}
              >
                {voice ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
              {status !== 'off' && (
                <button
                  className="icon-button"
                  title="Stop local camera analysis"
                  aria-label="Stop local camera analysis"
                  onClick={() => {
                    stop();
                    setStatus('off');
                    setAnalysis({
                      ...empty,
                      reps: tally.current.reps,
                      holdSeconds: Math.floor(tally.current.holdMs / 1000),
                    });
                  }}
                >
                  <CameraOff size={18} />
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
      {settingsOpen && (
        <Modal title="Workout settings" onClose={() => setSettingsOpen(false)}>
          <div className="analyzer-settings">
            <section className="workout-setup" aria-label="Workout targets">
              <div className="workout-setup-title">
                <strong>{definition.name}</strong>
                <span>
                  {block ? 'Targets from your coach’s plan' : 'Set a comfortable target'}
                  {mode !== 'setup' && ' · Targets are locked during a workout'}
                </span>
              </div>
              <div className="workout-fields">
                <label>
                  Sets
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={config.sets}
                    disabled={mode !== 'setup'}
                    onChange={(e) => updateConfig({ sets: Number(e.target.value) })}
                  />
                </label>
                <label>
                  {isHoldExercise(exercise) ? 'Seconds per set' : 'Reps per set'}
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={config.target}
                    disabled={mode !== 'setup'}
                    onChange={(e) => updateConfig({ target: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Rest (seconds)
                  <input
                    type="number"
                    min={0}
                    max={300}
                    value={config.rest}
                    disabled={mode !== 'setup'}
                    onChange={(e) => updateConfig({ rest: Number(e.target.value) })}
                  />
                </label>
                <label>
                  External load (kg, optional)
                  <input
                    type="number"
                    min={0}
                    max={500}
                    step={0.5}
                    value={config.loadKg ?? ''}
                    disabled={mode === 'active'}
                    onChange={(event) =>
                      updateConfig({
                        loadKg: event.target.value === '' ? null : Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <details className="tracking-settings">
                <summary>Adjust tracking with your coach</summary>
                <p>
                  {profile.cameraCue}. Keep your head in view. Choose the arm or leg you want to
                  track. Your coach can adjust the range to your movement. Minor form issues lower
                  quality and show a correction.
                </p>
                <label className="model-quality-field">
                  Tracking quality
                  <select
                    value={modelVariant}
                    disabled={mode !== 'setup'}
                    onChange={(event) => {
                      const next = event.target.value as typeof modelVariant;
                      modelVariantRef.current = next;
                      setModelVariant(next);
                      setQualityNotice('');
                      cancelStart();
                      if (status !== 'off') {
                        const shared = ownStream.current
                          ? undefined
                          : (currentStream.current ?? undefined);
                        void start(shared);
                      }
                    }}
                  >
                    <option value="heavy">Heavy · More detail on fast devices</option>
                    <option value="full">Full · Balanced accuracy and speed</option>
                    <option value="lite">Performance · Lower accuracy</option>
                  </select>
                </label>
                {status === 'ready' && (
                  <p className="microcopy">
                    Tracking: {modelInfo.variant} · {modelInfo.delegate || 'device'} ·{' '}
                    {modelInfo.fps} analyzed frames/sec. If tracking feels slow, use Full or
                    Performance mode.
                  </p>
                )}
                {qualityNotice && (
                  <p className="microcopy" role="status">
                    {qualityNotice}
                  </p>
                )}
                <div className="workout-fields">
                  <label>
                    Body side
                    <select
                      value={config.side}
                      disabled={mode !== 'setup'}
                      onChange={(e) =>
                        updateConfig({ side: e.target.value as WorkoutConfig['side'] })
                      }
                    >
                      <option value="auto">Automatic</option>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                    </select>
                  </label>
                  {!isHoldExercise(exercise) && (
                    <>
                      <label>
                        Higher endpoint (°)
                        <input
                          type="number"
                          min={profile.signal === 'shoulder' ? 50 : 110}
                          max={175}
                          value={config.topAngle}
                          disabled={mode !== 'setup'}
                          onChange={(e) => updateConfig({ topAngle: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        Lower endpoint (°)
                        <input
                          type="number"
                          min={profile.signal === 'shoulder' ? 5 : 35}
                          max={config.topAngle - 25}
                          value={config.bottomAngle}
                          disabled={mode !== 'setup'}
                          onChange={(e) => updateConfig({ bottomAngle: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        Minimum rep time (ms)
                        <input
                          type="number"
                          min={350}
                          max={3000}
                          step={100}
                          value={config.minRepMs}
                          disabled={mode !== 'setup'}
                          onChange={(e) => updateConfig({ minRepMs: Number(e.target.value) })}
                        />
                      </label>
                    </>
                  )}
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={diagnosticsEnabled}
                    onChange={(event) => {
                      diagnosticsEnabledRef.current = event.target.checked;
                      setDiagnosticsEnabled(event.target.checked);
                      diagnosticBuffer.current = initialPoseDiagnostics();
                    }}
                  />
                  Record tracking report locally
                </label>
                <p className="microcopy">
                  Optional troubleshooting: keeps the last minute of joint coordinates and counter
                  states on this device. No video or audio is recorded. Nothing is uploaded.
                </p>
                <button
                  type="button"
                  className="button outline"
                  disabled={!diagnosticsEnabled || diagnosticBuffer.current.frames.length === 0}
                  onClick={() => {
                    const report = poseDiagnosticReport(diagnosticBuffer.current, {
                      userAgent: navigator.userAgent,
                      ruleVersion: RULE_VERSION,
                    });
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(report)], { type: 'application/json' }),
                    );
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = 'geez-squad-tracking-report.json';
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  Download tracking report
                </button>
              </details>
              {!profile.isHold && mode === 'setup' && (
                <button
                  type="button"
                  className="button outline"
                  disabled={status !== 'ready' || paused || Boolean(calibrationRef.current)}
                  onClick={() => {
                    cancelStart();
                    const next = beginMovementCalibration(performance.now());
                    calibrationRef.current = next;
                    setCalibration(next);
                    setSettingsOpen(false);
                    announce(next.cue, true);
                  }}
                >
                  Calibrate movement with your coach
                </button>
              )}
            </section>
            <section className="analyzer-instructions" aria-label="How to do this exercise">
              <h3>Movement & camera setup</h3>
              <p>
                {definition.instructions[0]} {definition.instructions[1]} Use bright, even lighting.
              </p>
              <ol>
                {movementSteps[exercise].map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="microcopy">
                Tap Start set before stepping back. Stay in your starting position through the
                five-second countdown. Small movements are tolerated; brief tracking uncertainty
                pauses the timer. Full, controlled movements count after Go. Pose analysis stays on
                your device. Form scores are camera estimates to review with your coach. Stop if a
                movement causes pain.
              </p>
            </section>
            {mode === 'active' && (
              <div className="analyzer-live-details">
                <div className="movement-metrics">
                  <span>
                    Last rep range:{' '}
                    <b>{analysis.rangeDegrees ? `${analysis.rangeDegrees}°` : '—'}</b>
                  </span>
                  <span>
                    Last rep time:{' '}
                    <b>
                      {analysis.lastRepSeconds ? `${analysis.lastRepSeconds.toFixed(1)}s` : '—'}
                    </b>
                  </span>
                  <span>
                    Joint angle: <b>{analysis.angle === null ? '—' : `${analysis.angle}°`}</b>
                  </span>
                  <span>
                    Last rep quality:{' '}
                    <b>
                      {analysis.lastRepQuality == null ? '—' : `${analysis.lastRepQuality}/100`}
                    </b>
                  </span>
                  <span>
                    Tracked side:{' '}
                    <b>
                      {analysis.trackedSide ??
                        (state.current.side === 0
                          ? 'left'
                          : state.current.side === 1
                            ? 'right'
                            : 'acquiring')}
                    </b>
                  </span>
                  <span>
                    Tracking coverage:{' '}
                    <b>
                      {analysis.trackingCoverage == null ? '—' : `${analysis.trackingCoverage}%`}
                    </b>
                  </span>
                  <span>
                    Geometry:{' '}
                    <b>
                      {analysis.geometrySource === '3d'
                        ? 'Estimated 3D'
                        : analysis.geometrySource === '2d'
                          ? 'Camera 2D'
                          : 'Acquiring'}
                    </b>
                  </span>
                  <span>
                    Rejected cycles: <b>{analysis.rejectedReps ?? 0}</b>
                  </span>
                  {analysis.rejectionReason && (
                    <span role="status">{analysis.rejectionReason}</span>
                  )}
                </div>
                <button
                  className="button outline"
                  onClick={() => {
                    finishSet(analysis);
                    setSettingsOpen(false);
                  }}
                >
                  Finish set early
                </button>
              </div>
            )}
            {!!completedSets.length && (
              <div className="set-results">
                <h3>
                  <CheckCircle2 size={18} /> Your set results
                </h3>
                <p className="microcopy">
                  {saveForUser
                    ? 'Save status appears under your camera. Saved summaries are available in Insights.'
                    : 'Set details stay on this page. Enable saved history in signed-in practice to keep them.'}
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Set</th>
                      <th>{isHoldExercise(exercise) ? 'Seconds' : 'Reps'}</th>
                      <th>Target</th>
                      <th>Form estimate</th>
                      <th>Rep quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedSets.map((s) => (
                      <tr key={s.number}>
                        <td>{s.number}</td>
                        <td>{s.amount}</td>
                        <td>
                          {s.amount >= config.target ? 'Reached' : `${s.amount} / ${config.target}`}
                        </td>
                        <td>{s.score === null ? '—' : `${s.score}/100`}</td>
                        <td>{s.quality === null ? '—' : `${s.quality}/100`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button
              className="button lime analyzer-settings-done"
              onClick={() => setSettingsOpen(false)}
            >
              Done
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
