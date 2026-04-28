/**
 * ORBITAL Core — Motor de decisión
 * -----------------------------------------------------------------------------
 * Función principal: decideFillForGap.
 *
 * Pura: mismo input → mismo output. Sin IO. Sin side effects.
 * No depende de Prisma, React, ni de @/data/mock.
 *
 * Cierra estructuralmente CLEAN-CORE-1 (idioma — emite ExplanationCode),
 * CLEAN-CORE-2 (dominio — solo primitivas universales), CLEAN-CORE-4
 * (moneda — MonetaryAmount sin símbolo), CLEAN-CORE-5 (unidades — DurationMs
 * en ms con baseSlotUnit configurable), CLEAN-CORE-6 (tipos externos — todo
 * vive en lib/core/). CLEAN-CORE-3 (UI) se cierra con components/styles.ts
 * en Fase 9d.
 *
 * Ver core-contract.md §5.
 */

import type {
  EngineResult,
  ExplanationCode,
  Gap,
  RankedCandidate,
  ScheduledEvent,
  ScoreBreakdown,
  Suggestion,
  WaitingCandidate,
  DecisionState,
} from "./types";
import type { EngineConfig } from "./config";
import { DEFAULT_CONFIG, validateConfig } from "./config";

// =============================================================================
// FUNCIÓN PRINCIPAL
// =============================================================================

export function decideFillForGap(
  events: ReadonlyArray<ScheduledEvent>,
  waitingList: ReadonlyArray<WaitingCandidate>,
  config: EngineConfig = DEFAULT_CONFIG,
  decision: DecisionState = "pending",
): EngineResult {
  validateConfig(config);

  const gaps = detectGaps(events, config);

  if (gaps.length === 0) {
    return {
      gaps: [],
      rankingsByGap: new Map(),
      suggestions: [],
      recoveredValue: 0,
      recoveredGapsCount: 0,
      decision,
    };
  }

  const rankingsByGap = new Map<string, ReadonlyArray<RankedCandidate>>();
  const suggestions: Suggestion[] = [];

  for (const gap of gaps) {
    const viable = filterViableCandidates(waitingList, gap, config);

    if (viable.length === 0) {
      rankingsByGap.set(gap.sourceEventId, []);
      continue;
    }

    const valueRange = computeValueRange(viable);
    const ranked = viable
      .map((c) => scoreCandidate(c, gap, valueRange, config))
      .sort(compareRanked);

    rankingsByGap.set(gap.sourceEventId, ranked);

    if (decision !== "rejected") {
      const top = ranked[0];
      const topCandidate = viable.find((c) => c.id === top.candidateId)!;
      suggestions.push({
        gapSourceEventId: gap.sourceEventId,
        candidateId: top.candidateId,
        resourceId: gap.resourceId,
        start: gap.start,
        duration: gap.duration,
        value: topCandidate.value,
      });
    }
  }

  const recoveredValue =
    decision === "accepted"
      ? suggestions.reduce((sum, s) => sum + s.value, 0)
      : 0;
  const recoveredGapsCount = decision === "accepted" ? suggestions.length : 0;

  return {
    gaps,
    rankingsByGap,
    suggestions,
    recoveredValue,
    recoveredGapsCount,
    decision,
  };
}

// =============================================================================
// DETECCIÓN DE GAPS
// =============================================================================

function detectGaps(
  events: ReadonlyArray<ScheduledEvent>,
  config: EngineConfig,
): ReadonlyArray<Gap> {
  switch (config.gapDetection) {
    case "first_cancelled": {
      const cancelled = events.find((e) => e.status === "cancelled");
      if (!cancelled) return [];
      return [
        {
          resourceId: cancelled.resourceId,
          start: cancelled.start,
          duration: cancelled.duration,
          lostValue: cancelled.value,
          sourceEventId: cancelled.id,
          gapType: "cancelled",
        },
      ];
    }
    case "all_cancelled":
      throw new Error(
        "GapDetectionStrategy 'all_cancelled' aún no implementada (ENGINE-MULTI-GAP). Usar 'first_cancelled' hasta sesión futura.",
      );
    case "all_cancelled_plus_natural":
      throw new Error(
        "GapDetectionStrategy 'all_cancelled_plus_natural' es Fase 2+. No implementada.",
      );
    default: {
      const _exhaustive: never = config.gapDetection;
      return _exhaustive;
    }
  }
}

// =============================================================================
// FILTRADO DE CANDIDATOS
// =============================================================================

function filterViableCandidates(
  candidates: ReadonlyArray<WaitingCandidate>,
  gap: Gap,
  config: EngineConfig,
): ReadonlyArray<WaitingCandidate> {
  if (config.oversizeHandling === "hard_filter") {
    return candidates.filter((c) => c.requiredDuration <= gap.duration);
  }
  // soft_penalty: incluye todos, el scoring penaliza vía fitScore = 0.
  return candidates;
}

// =============================================================================
// VALUE RANGE
// =============================================================================

function computeValueRange(viable: ReadonlyArray<WaitingCandidate>): {
  min: number;
  max: number;
} {
  if (viable.length === 0) return { min: 0, max: 0 };
  let min = viable[0].value;
  let max = viable[0].value;
  for (const c of viable) {
    if (c.value < min) min = c.value;
    if (c.value > max) max = c.value;
  }
  return { min, max };
}

// =============================================================================
// SCORING
// =============================================================================

function scoreCandidate(
  candidate: WaitingCandidate,
  gap: Gap,
  valueRange: { min: number; max: number },
  config: EngineConfig,
): RankedCandidate {
  // 1. Valor (normalizado min/max sobre viables; mismo comportamiento v7.3).
  const span = valueRange.max - valueRange.min;
  const valueScore =
    span === 0 ? 1.0 : (candidate.value - valueRange.min) / span;

  // 2. Encaje de duración (vía estrategia configurable).
  const fitScore = config.fit.computeFit(
    gap.duration,
    candidate.requiredDuration,
    config.fit.baseSlotUnit,
  );

  // 3. Facilidad (clamp; el caller debería pasarla normalizada en domains/).
  const easeScore = clamp01(candidate.easeScore);

  // 4. Disponibilidad inmediata (mismos valores que v7.3).
  const availabilityScore = candidate.availableNow ? 1.0 : 0.2;

  // 5. Recurso preferido.
  // - Sin preferencia → 1.0 (neutral).
  // - Preferencia cumplida → 1.0 (match).
  // - Preferencia no cumplida → 0.5 (mismatch).
  const resourceScore =
    candidate.preferredResourceId === null
      ? 1.0
      : candidate.preferredResourceId === gap.resourceId
        ? 1.0
        : 0.5;

  // 6. Prioridad (clamp).
  const priorityScore = clamp01(candidate.priority);

  const w = config.weights;
  const totalRaw =
    w.value * valueScore +
    w.fit * fitScore +
    w.ease * easeScore +
    w.availability * availabilityScore +
    w.resource * resourceScore +
    w.priority * priorityScore;

  // Truncado a 4 decimales: fidelidad numérica con v7.3 (§9.7 del contrato).
  const totalScore = Number(totalRaw.toFixed(4));

  const breakdown: ScoreBreakdown = {
    valueScore: round3(valueScore),
    fitScore: round3(fitScore),
    easeScore: round3(easeScore),
    availabilityScore: round3(availabilityScore),
    resourceScore: round3(resourceScore),
    priorityScore: round3(priorityScore),
  };

  const explanationCodes = buildExplanationCodes(
    fitScore,
    resourceScore,
    availabilityScore,
    candidate,
  );

  return {
    candidateId: candidate.id,
    totalScore,
    breakdown,
    explanationCodes,
  };
}

function buildExplanationCodes(
  fitScore: number,
  resourceScore: number,
  availabilityScore: number,
  candidate: WaitingCandidate,
): ReadonlyArray<ExplanationCode> {
  const codes: ExplanationCode[] = [];

  // Fit
  if (fitScore >= 1.0 - 1e-6) codes.push("FIT_EXACT");
  else if (fitScore >= 0.7 - 1e-6) codes.push("FIT_NEAR");
  else codes.push("FIT_LOOSE");

  // Resource (corrección honesta vs v7.3: distinguimos NEUTRAL de MATCH).
  if (candidate.preferredResourceId === null) {
    codes.push("RESOURCE_NEUTRAL");
  } else if (resourceScore >= 1.0 - 1e-6) {
    codes.push("RESOURCE_MATCH");
  } else {
    codes.push("RESOURCE_MISMATCH");
  }

  // Availability (solo si limitada; la inmediata es default y no aporta señal).
  if (availabilityScore < 1.0 - 1e-6) {
    codes.push("AVAILABILITY_LIMITED");
  }

  return codes;
}

// =============================================================================
// HELPERS
// =============================================================================

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function round3(x: number): number {
  return Number(x.toFixed(3));
}

function compareRanked(a: RankedCandidate, b: RankedCandidate): number {
  // Score descendente, desempate por candidateId lexicográfico (§9.6 del contrato).
  if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
  return a.candidateId.localeCompare(b.candidateId);
}