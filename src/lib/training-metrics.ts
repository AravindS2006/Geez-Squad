import type { Analysis } from './pose-engine';

export type TrainingMetrics = {
  lastAt: number | null;
  previousTracked: boolean;
  lastReps: number;
  activeMs: number;
  trackedMs: number;
  scoredMs: number;
  scoreTotal: number;
  confidenceTotal: number;
  confidenceMs: number;
  repSamples: number;
  qualityTotal: number;
  qualitySamples: number;
  rangeTotal: number;
  tempoTotal: number;
  rejectedReps: number;
  lastRejectionAt: number;
};
export function initialTrainingMetrics(reps = 0, timestamp: number | null = null): TrainingMetrics {
  return {
    lastAt: timestamp,
    previousTracked: timestamp !== null,
    lastReps: reps,
    activeMs: 0,
    trackedMs: 0,
    scoredMs: 0,
    scoreTotal: 0,
    confidenceTotal: 0,
    confidenceMs: 0,
    repSamples: 0,
    qualityTotal: 0,
    qualitySamples: 0,
    rangeTotal: 0,
    tempoTotal: 0,
    rejectedReps: 0,
    lastRejectionAt: 0,
  };
}
export function pauseTrainingMetrics(state: TrainingMetrics) {
  state.lastAt = null;
  state.previousTracked = false;
}
export function observeTrainingMetrics(
  state: TrainingMetrics,
  analysis: Analysis,
  timestamp: number,
  rejectionAt = 0,
) {
  if (!Number.isFinite(timestamp) || (state.lastAt !== null && timestamp <= state.lastAt)) return;
  const gap = state.lastAt === null ? 0 : timestamp - state.lastAt;
  const dt = gap > 0 && gap <= 750 ? gap : 0;
  state.activeMs += dt;
  if (analysis.tracked && state.previousTracked) {
    state.trackedMs += dt;
    if (analysis.score !== null && Number.isFinite(analysis.score)) {
      state.scoredMs += dt;
      state.scoreTotal += analysis.score * dt;
    }
    state.confidenceMs += dt;
    state.confidenceTotal += analysis.confidence * dt;
  }
  if (analysis.reps === state.lastReps + 1) {
    state.repSamples++;
    if (analysis.lastRepQuality != null) {
      state.qualityTotal += analysis.lastRepQuality;
      state.qualitySamples++;
    }
    state.rangeTotal += analysis.rangeDegrees ?? 0;
    state.tempoTotal += analysis.lastRepSeconds ?? 0;
  }
  state.lastReps = analysis.reps;
  if (analysis.rejectionReason && rejectionAt > state.lastRejectionAt) {
    state.rejectedReps++;
    state.lastRejectionAt = rejectionAt;
  }
  state.lastAt = timestamp;
  state.previousTracked = analysis.tracked;
}
export function trainingMetricsSummary(state: TrainingMetrics) {
  const average = (total: number, count: number) =>
    count ? Math.round((total / count) * 10) / 10 : null;
  return {
    activeMs: Math.round(state.activeMs),
    trackedMs: Math.round(state.trackedMs),
    formScore: average(state.scoreTotal, state.scoredMs),
    qualityScore: average(state.qualityTotal, state.qualitySamples),
    rangeDegrees: average(state.rangeTotal, state.repSamples),
    repSeconds: average(state.tempoTotal, state.repSamples),
    confidence: state.confidenceMs ? state.confidenceTotal / state.confidenceMs : null,
    rejectedReps: state.rejectedReps,
    trackingCoverage: state.activeMs ? Math.round((state.trackedMs / state.activeMs) * 100) : null,
  };
}
