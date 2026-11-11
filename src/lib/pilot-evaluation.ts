export type PilotResult = {
  participantId: string;
  exercise: string;
  mode?: string;
  device: string;
  model: string;
  expectedReps: number;
  observedReps: number;
  exactCount: boolean;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  holdErrorMs: number | null;
  physicalDevice?: boolean;
  setId?: string;
  ruleVersion?: string;
};
export type ReleaseGate =
  | 'overall-participants'
  | 'coverage'
  | 'accuracy'
  | 'negatives'
  | 'physical-device'
  | 'rule-version';
/** A passing replay is evidence, not permission to promote a profile or deploy. */
export function pilotReleaseGates(results: PilotResult[], ruleVersion?: string) {
  const overallParticipants = new Set(results.map((r) => r.participantId)).size;
  const groups = new Map<string, PilotResult[]>();
  for (const row of results) {
    const key = `${row.exercise}:${row.mode ?? 'default'}:${row.model}:${row.device}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([group, rows]) => {
    const positives = rows.filter((r) => r.expectedReps > 0),
      holds = rows.filter((r) => r.holdErrorMs !== null);
    const participants = new Set(rows.map((r) => r.participantId)).size;
    const repetitions = positives.reduce((s, r) => s + r.expectedReps, 0);
    const sets = new Set(positives.map((r, i) => r.setId ?? `clip:${i}`)).size;
    const negatives = rows.filter((r) => r.expectedReps === 0 && r.holdErrorMs === null).length;
    const tp = rows.reduce((s, r) => s + r.truePositives, 0),
      fp = rows.reduce((s, r) => s + r.falsePositives, 0),
      fn = rows.reduce((s, r) => s + r.falseNegatives, 0);
    const precision = tp + fp ? tp / (tp + fp) : 0,
      recall = tp + fn ? tp / (tp + fn) : 0;
    const exactSets = positives.length
      ? positives.filter((r) => r.exactCount).length / positives.length
      : null;
    const holdsWithinOneSecond = holds.length
      ? holds.filter((r) => r.holdErrorMs! <= 1000).length / holds.length
      : null;
    const coverage = holds.length
      ? holds.length >= 30 && participants >= 10
      : repetitions >= 300 && sets >= 30 && participants >= 10;
    const accuracy = holds.length
      ? holdsWithinOneSecond! >= 0.95
      : precision >= 0.99 && recall >= 0.97 && exactSets! >= 0.95;
    // Evidence counts only for the rules that produced it: a group replayed under
    // another rule version, or a mix of versions, says nothing about current counting.
    const versions = new Set(rows.map((r) => r.ruleVersion ?? 'unknown'));
    const currentRules =
      ruleVersion === undefined || (versions.size === 1 && versions.has(ruleVersion));
    const failedGates: ReleaseGate[] = [];
    if (overallParticipants < 20) failedGates.push('overall-participants');
    if (!coverage) failedGates.push('coverage');
    if (!accuracy) failedGates.push('accuracy');
    if (negatives < 30) failedGates.push('negatives');
    if (!rows.some((r) => r.physicalDevice)) failedGates.push('physical-device');
    if (!currentRules) failedGates.push('rule-version');
    return {
      group,
      exercise: rows[0].exercise,
      ruleVersions: [...versions],
      failedGates,
      participants,
      repetitions,
      sets,
      negatives,
      precision,
      recall,
      exactSets,
      holdsWithinOneSecond,
      physicalEvidence: rows.some((r) => r.physicalDevice),
      releaseReady: failedGates.length === 0,
    };
  });
}
