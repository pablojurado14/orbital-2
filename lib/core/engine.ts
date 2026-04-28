import type {
  EngineResult, Gap, RankedCandidate, ScheduledEvent, ScoreBreakdown,
  Suggestion, WaitingCandidate, ExplanationCode, DecisionState,
} from "./types";
import type { CandidateId, MonetaryAmount, ScoreRatio } from "./primitives";
import { DEFAULT_CONFIG, defaultComputeFit, validateConfig, type EngineConfig } from "./config";

interface ValueRange {
  readonly min: MonetaryAmount;
  readonly max: MonetaryAmount;
}

function detectGap(events: ReadonlyArray<ScheduledEvent>, cfg: EngineConfig): Gap | null {
  const sorted = [...events].sort((a, b) => {
    if (a.resourceId !== b.resourceId) return a.resourceId < b.resourceId ? -1 : 1;
    return a.start - b.start;
  });
  if (cfg.gapDetection === "first_cancelled") {
    const cancelled = sorted.find((e) => e.status === "cancelled");
    if (!cancelled) return null;
    return {
      resourceId: cancelled.resourceId,
      start: cancelled.start,
      duration: cancelled.duration,
      originEventId: cancelled.id,
    };
  }
  if (cfg.gapDetection === "all_cancelled") {
    throw new Error("gapDetection 'all_cancelled' no implementado en v1.0 — pendiente Sesión 14");
  }
  return null;
}

function computeValueRange(candidates: ReadonlyArray<WaitingCandidate>): ValueRange {
  if (candidates.length === 0) return { min: 0, max: 0 };
  let min = Infinity, max = -Infinity;
  for (const c of candidates) {
    if (c.value < min) min = c.value;
    if (c.value > max) max = c.value;
  }
  return { min, max };
}

function normalizeValue(v: MonetaryAmount, range: ValueRange): ScoreRatio {
  if (range.max === range.min) return 1.0;
  return (v - range.min) / (range.max - range.min);
}

function computeAvailabilityCode(c: WaitingCandidate): ExplanationCode {
  return c.availableNow ? "AVAILABILITY_HIGH" : "AVAILABILITY_LOW";
}

function computeResourceCode(c: WaitingCandidate, gap: Gap): ExplanationCode {
  if (!c.preferredResourceId) return "RESOURCE_NEUTRAL";
  return c.preferredResourceId === gap.resourceId ? "RESOURCE_MATCH" : "RESOURCE_MISMATCH";
}

function computeFitCode(diffMs: number, cfg: EngineConfig): ExplanationCode {
  const TOL = 1e-6;
  if (diffMs <= cfg.fit.nearToleranceMs) return "FIT_EXACT";
  if (diffMs <= cfg.fit.baseSlotUnit + TOL) return "FIT_NEAR";
  return "FIT_LOOSE";
}

function computeValueCode(normValue: ScoreRatio): ExplanationCode {
  if (normValue >= 0.7) return "VALUE_HIGH";
  if (normValue >= 0.3) return "VALUE_MEDIUM";
  return "VALUE_LOW";
}

function scoreCandidate(
  candidate: WaitingCandidate, gap: Gap, valueRange: ValueRange, cfg: EngineConfig
): RankedCandidate {
  const normValue = normalizeValue(candidate.value, valueRange);
  const fit = defaultComputeFit(candidate.desiredDuration, gap.duration, cfg.fit);
  const ease = candidate.easeScore;
  const availability = candidate.availableNow ? cfg.availability.highWhenAvailable : cfg.availability.lowWhenUnavailable;
  const resource = !candidate.preferredResourceId
    ? cfg.resource.matchOrNeutral
    : candidate.preferredResourceId === gap.resourceId
      ? cfg.resource.matchOrNeutral
      : cfg.resource.mismatch;
  const priority = candidate.priority;
  const breakdown: ScoreBreakdown = { value: normValue, fit, ease, availability, resource, priority };
  const w = cfg.weights;
  const totalScore =
    normValue * w.value + fit * w.fit + ease * w.ease +
    availability * w.availability + resource * w.resource + priority * w.priority;
  const explanationCodes: ExplanationCode[] = [
    computeFitCode(gap.duration - candidate.desiredDuration, cfg),
    computeResourceCode(candidate, gap),
    computeAvailabilityCode(candidate),
    computeValueCode(normValue),
  ];
  if (priority >= 0.7) explanationCodes.push("PRIORITY_HIGH");
  if (ease >= 0.7) explanationCodes.push("EASE_HIGH");
  else if (ease < 0.3) explanationCodes.push("EASE_LOW");
  return { candidateId: candidate.id, totalScore, breakdown, explanationCodes };
}

function compareRanked(a: RankedCandidate, b: RankedCandidate): number {
  if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
  return a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0;
}

export function decideFillForGap(
  events: ReadonlyArray<ScheduledEvent>,
  waitingList: ReadonlyArray<WaitingCandidate>,
  config: EngineConfig = DEFAULT_CONFIG,
  decision: DecisionState = "pending"
): EngineResult {
  validateConfig(config);
  const gap = detectGap(events, config);
  if (!gap) return { suggestions: [], recoveredValue: 0, recoveredGaps: 0, decision };
  const viable = waitingList.filter((c) => c.desiredDuration <= gap.duration);
  if (viable.length === 0) return { suggestions: [], recoveredValue: 0, recoveredGaps: 0, decision };
  const valueRange = computeValueRange(viable);
  const ranked = viable.map((c) => scoreCandidate(c, gap, valueRange, config));
  ranked.sort(compareRanked);
  const [recommended, ...alternatives] = ranked;
  const suggestion: Suggestion = { gap, recommended, alternatives };
  const recoveredValue = decision === "accepted"
    ? viable.find((c) => c.id === recommended.candidateId)?.value ?? 0 : 0;
  const recoveredGaps = decision === "accepted" ? 1 : 0;
  return { suggestions: [suggestion], recoveredValue, recoveredGaps, decision };
}

// El parámetro está aquí para que TypeScript no marque la importación como
// no usada. CandidateId se usa indirectamente vía RankedCandidate.candidateId.
export type _UnusedTypeMarker = CandidateId;