/**
 * Coordinator (C6) — Sesión 17.
 *
 * Sexto y último componente vivo del clean core. Implementa la API del
 * Componente 6 según core-contract.md §6 y logica-reoptimizacion-saas.md §10:
 *
 *   runCycle(event, state, runtimes, contexts, options?) → CycleDecision
 *
 * Es el ÚNICO componente que conoce el flujo completo del motor.
 * Orquesta C2+C3+C4+C5 en cada ciclo. C1 NO se invoca aquí en v1
 * (deuda COORDINATOR-PREDICTOR-INTEGRATION-V1: el adapter pre-puebla
 * los riesgos en el state).
 *
 * Flujo interno (5 pasos):
 *   1. Inferir GenerationTrigger desde el EngineEvent + state.
 *   2. Llamar a C3 Generator → ReadonlyArray<CompositeAction>.
 *   3. Por cada candidata: C4 Simulator → SimulationResult, C5 Scorer → ScoreResult.
 *      Si Simulator lanza, descartar candidata silenciosamente (mismo patrón
 *      que C3.keepValid).
 *   4. Seleccionar ganadora: la de mayor totalScore si supera el umbral
 *      score(no_op) + improvementThreshold. Si no, gana no_op.
 *   5. Construir CycleDecision con Explanation completa.
 *
 * Autonomía v1: siempre devuelve autonomyLevel="detailed_suggestion" y
 * autoExecutedActions=[]. Los otros 3 niveles requieren configuración por
 * tenant + criterios de elegibilidad. Diferido a sesión post-piloto
 * (deuda COORDINATOR-AUTONOMY-V1-MINIMAL).
 *
 * Deudas blandas registradas:
 *   - COORDINATOR-PREDICTOR-INTEGRATION-V1
 *   - COORDINATOR-AUTONOMY-V1-MINIMAL
 *   - COORDINATOR-EVENT-TRIGGER-COVERAGE-V1
 *   - COORDINATOR-MOTIVE-CODE-FOR-NO-OP: cuando gana no_op no hay un
 *     motiveCode semánticamente correcto en la enumeración v1.
 *     Decisión: usar RECOVERS_BILLABLE_VALUE como default genérico.
 */

import type {
  AppointmentState,
  CompositeAction,
  ConsideredAlternative,
  CycleDecision,
  DayState,
  DiscardReasonCode,
  EngineEvent,
  Explanation,
  ExplanationMotiveCode,
  KPIVector,
  PrimitiveAction,
} from "./types";
import { generateCandidates } from "./generator";
import type { GenerationTrigger } from "./generator-types";
import type { AppointmentRuntimeMap } from "./state-transitions";
import type { ApplyOptions } from "./state-transitions";
import { simulate } from "./simulator";
import { score } from "./scorer";
import type { ScoreResult } from "./scorer-types";
import {
  DEFAULT_IMPROVEMENT_THRESHOLD,
  DEFAULT_TOP_K_ALTERNATIVES,
  type CoordinatorContexts,
  type CoordinatorOptions,
} from "./coordinator-types";

// =============================================================================
// Constantes
// =============================================================================

const NO_OP_ACTION: CompositeAction = [{ kind: "no_op" }];

// =============================================================================
// Helpers — inferencia de trigger desde EngineEvent
// =============================================================================

function isAppointmentLive(a: AppointmentState): boolean {
  return a.runtimeStatus !== "cancelled" && a.runtimeStatus !== "no_show";
}

/**
 * Infiere un GenerationTrigger a partir de un EngineEvent + state + runtimes.
 *
 * Retorna null si el evento no tiene mapeo a un trigger en v1
 * (patient_arrival, appointment_started, in_progress_update, walk_in,
 * equipment_unavailable, constraint_change, manual_signal).
 *
 * Para appointment_completed, devuelve overrun_propagation SOLO si la
 * duración real excede el p90 estimado del state. Si no excede, devuelve null
 * (la cita terminó dentro de lo esperado, no hay nada que orquestar).
 *
 * Para cancellation, sintetiza un Gap a partir del runtime del evento
 * cancelado.
 */
export function inferTrigger(
  event: EngineEvent,
  state: DayState,
  runtimes: AppointmentRuntimeMap,
): GenerationTrigger | null {
  switch (event.kind) {
    case "cancellation": {
      const r = runtimes[event.eventId];
      if (r === undefined) return null;
      return {
        kind: "gap_detected",
        gap: {
          resourceId: r.roomId,
          start: r.start,
          duration: r.plannedDuration,
          originEventId: event.eventId,
        },
      };
    }

    case "no_show_detected": {
      return {
        kind: "no_show",
        eventId: event.eventId,
      };
    }

    case "professional_absence": {
      return {
        kind: "professional_unavailable",
        professionalId: event.professionalId,
        rangeStart: event.absenceRange.start,
        rangeEnd: event.absenceRange.end,
      };
    }

    case "proactive_tick": {
      return { kind: "proactive_sweep" };
    }

    case "appointment_completed": {
      const apt = state.appointments.find((a) => a.eventId === event.eventId);
      if (apt === undefined) return null;
      const completedRuntime = runtimes[event.eventId];
      if (completedRuntime === undefined) return null;

      // Overrun solo si la duración real excede el p90 estimado.
      const p90 = apt.estimatedEndDistribution.p90;
      if (event.actualDuration <= p90) return null;

      // Calcular downstream del mismo profesional con start > start del completado.
      const downstreamIds: string[] = [];
      for (const a of state.appointments) {
        if (!isAppointmentLive(a)) continue;
        if (a.eventId === event.eventId) continue;
        const r = runtimes[a.eventId];
        if (r === undefined) continue;
        if (r.professionalId !== completedRuntime.professionalId) continue;
        if (r.start <= completedRuntime.start) continue;
        downstreamIds.push(a.eventId);
      }

      return {
        kind: "overrun_propagation",
        originEventId: event.eventId,
        estimatedSlippage: event.actualDuration - apt.estimatedEndDistribution.p50,
        affectedDownstreamEventIds: downstreamIds,
      };
    }

    // Eventos sin trigger directo en v1.
    case "patient_arrival":
    case "appointment_started":
    case "in_progress_update":
    case "walk_in":
    case "equipment_unavailable":
    case "constraint_change":
    case "manual_signal":
      return null;
  }
}

// =============================================================================
// Helpers — derivación de motiveCode y discardReasonCode
// =============================================================================

/**
 * Deriva un ExplanationMotiveCode a partir de la composite ganadora.
 * Mapeo basado en la primera primitiva no-no_op de la composite.
 *
 * Si la ganadora es no_op (todas las primitivas son no_op o composite vacía),
 * devuelve RECOVERS_BILLABLE_VALUE como default genérico.
 * Documentado como deuda COORDINATOR-MOTIVE-CODE-FOR-NO-OP.
 */
export function deriveMotiveCode(
  action: CompositeAction,
): ExplanationMotiveCode {
  const firstReal = action.find((p) => p.kind !== "no_op");
  if (firstReal === undefined) return "RECOVERS_BILLABLE_VALUE";

  switch (firstReal.kind) {
    case "fill_from_waitlist":
      return "FILLS_GAP_WITH_VALUE";
    case "reassign_professional":
      return "REASSIGNS_TO_AVAILABLE_PROFESSIONAL";
    case "compress":
    case "postpone":
      return "PREVENTS_OVERRUN_PROPAGATION";
    case "advance":
      return "REDUCES_WAIT_TIME";
    case "expand":
      return "AVOIDS_OVERTIME";
    case "move":
    case "reassign_resource":
      return "USES_FREED_RESOURCE";
    case "cancel_and_reschedule":
      return "PREVENTS_FORCED_CANCELLATION";
  }
}

/**
 * Deriva un DiscardReasonCode para una candidata descartada (no ganadora).
 *
 * Orden de evaluación (primer match gana):
 *   1. WORSE_THAN_NO_OP — totalScore < score(no_op).
 *   2. MARGINAL_IMPROVEMENT — totalScore mejora sobre no_op pero menos del umbral.
 *   3. HIGH_VARIANCE — riskPenalty > 50% del kpiSubtotal absoluto.
 *   4. HIGH_CHANGE_COST — changeCostPenalty > 50% del kpiSubtotal absoluto.
 *   5. DOMINATED_BY_ALTERNATIVE — default residual.
 *
 * Nota: HARD_CONSTRAINT_VIOLATION no se evalúa aquí porque las candidatas
 * que llegan al Coordinator ya pasaron el Validator de C3 (invariante I-26).
 * DEPENDS_ON_EXTERNAL_RESPONSE no se modela en v1 (requiere distinguir
 * acciones que avisan al paciente con respuesta condicional).
 */
export function deriveDiscardReasonCode(
  candidateScore: ScoreResult,
  noOpScore: ScoreResult,
  improvementThreshold: number,
): DiscardReasonCode {
  if (candidateScore.totalScore < noOpScore.totalScore) {
    return "WORSE_THAN_NO_OP";
  }

  const improvement = candidateScore.totalScore - noOpScore.totalScore;
  if (improvement < improvementThreshold) {
    return "MARGINAL_IMPROVEMENT";
  }

  const subtotalAbs = Math.abs(candidateScore.breakdown.kpiSubtotal);
  if (subtotalAbs > 0) {
    if (candidateScore.breakdown.riskPenalty > subtotalAbs * 0.5) {
      return "HIGH_VARIANCE";
    }
    if (candidateScore.breakdown.changeCostPenalty > subtotalAbs * 0.5) {
      return "HIGH_CHANGE_COST";
    }
  }

  return "DOMINATED_BY_ALTERNATIVE";
}

// =============================================================================
// Helpers — evaluación de candidatas
// =============================================================================

interface ScoredCandidate {
  readonly action: CompositeAction;
  readonly scoreResult: ScoreResult;
  readonly projectedKPIs: KPIVector;
}

/**
 * Evalúa una lista de candidatas: simula y puntúa cada una. Si la simulación
 * lanza (ej: fill_from_waitlist sin applyOptions), descarta esa candidata.
 *
 * Devuelve la lista con todas las candidatas evaluables, sin orden.
 */
function evaluateCandidates(
  candidates: ReadonlyArray<CompositeAction>,
  state: DayState,
  contexts: CoordinatorContexts,
  options: CoordinatorOptions,
): ReadonlyArray<ScoredCandidate> {
  const applyOptions =
    options.applyOptions ?? buildDefaultApplyOptions(contexts);

  const evaluated: ScoredCandidate[] = [];
  for (const action of candidates) {
    try {
      const simResult = simulate(state, action, contexts.simulation, {
        ...options.simulationOptions,
        applyOptions,
      });
      const scoreResult = score(simResult, action, options.scorerOptions);
      evaluated.push({
        action,
        scoreResult,
        projectedKPIs: simResult.expectedKPIs,
      });
    } catch {
      // Candidata no evaluable — la omitimos silenciosamente, mismo patrón
      // que C3.keepValid.
    }
  }
  return evaluated;
}

/**
 * Construye un FillFromWaitlistContext por defecto desde los contexts agregados.
 * Se usa cuando el caller no pasa options.applyOptions explícitamente y alguna
 * candidata contiene fill_from_waitlist (común tras runCycle sobre cancellation
 * o no_show).
 *
 * Heurística "primer profesional compatible" — misma que C3 Generator usa
 * internamente. Documentado como deuda blanda COORDINATOR-FILL-CONTEXT-V1:
 * cuando WaitlistEntry esté plenamente integrado con desiredProcedureId
 * (Sesión 18+), aquí se llamará a listCompatible() del Validator en lugar de
 * "first available".
 */
function buildDefaultApplyOptions(
  contexts: CoordinatorContexts,
): ApplyOptions {
  return {
    fillFromWaitlist: {
      waitingCandidates: contexts.generation.waitlist.candidates,
      resolveProfessional: () => {
        const professionals = contexts.validation.professionals;
        return professionals[0]?.professionalId ?? null;
      },
      buildEstimatedDistribution: (candidate) => ({
        mean: candidate.desiredDuration,
        stdDev: 0,
        p10: candidate.desiredDuration,
        p50: candidate.desiredDuration,
        p90: candidate.desiredDuration,
      }),
    },
  };
}

/**
 * Encuentra la candidata no_op en la lista evaluada. La invariante I-13
 * garantiza que siempre existe entre las generadas; si por algún motivo
 * (tests con fixtures incompletos) no aparece, devuelve null y el caller
 * decide.
 */
function findNoOp(
  evaluated: ReadonlyArray<ScoredCandidate>,
): ScoredCandidate | null {
  return (
    evaluated.find((e) =>
      e.action.every((p: PrimitiveAction) => p.kind === "no_op"),
    ) ?? null
  );
}

// =============================================================================
// API pública — runCycle
// =============================================================================

/**
 * Ejecuta un ciclo completo del motor: observa el evento, piensa generando
 * y evaluando candidatas, propone una decisión.
 *
 * @param event evento de entrada que dispara el ciclo.
 * @param state DayState actual del tenant (con riesgos pre-poblados).
 * @param runtimes runtimes paralelos al state.
 * @param contexts agregación de los contexts que C2/C3/C4 necesitan.
 * @param options opcional con pesos del Scorer, umbrales, etc.
 *
 * @returns CycleDecision con proposal (null si gana no_op), Explanation
 * completa, autonomyLevel y autoExecutedActions.
 */
export function runCycle(
  event: EngineEvent,
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  contexts: CoordinatorContexts,
  options: CoordinatorOptions = {},
): CycleDecision {
  const improvementThreshold =
    options.improvementThreshold ?? DEFAULT_IMPROVEMENT_THRESHOLD;
  const topK = options.topKAlternatives ?? DEFAULT_TOP_K_ALTERNATIVES;

  // 1. Inferir trigger.
  const trigger = inferTrigger(event, state, runtimes);

  // 2. Generar candidatas. Si trigger es null, solo no_op.
  const candidates: ReadonlyArray<CompositeAction> =
    trigger === null
      ? [NO_OP_ACTION]
      : generateCandidates(
          state,
          runtimes,
          trigger,
          contexts.generation,
          options.generationOptions,
        );

  // 3. Evaluar todas las candidatas.
  const evaluated = evaluateCandidates(candidates, state, contexts, options);

  // 4. Encontrar no_op como referencia.
  const noOp = findNoOp(evaluated);

  // Caso degenerado: no_op no se pudo evaluar (no debería pasar en
  // producción gracias a I-13, pero defensivamente devolvemos un decision
  // mínimo).
  if (noOp === null) {
    return buildFallbackDecision();
  }

  // Identificar ganadora: la de mayor totalScore que supere
  // noOp.totalScore + improvementThreshold. Si ninguna supera, gana no_op.
  const nonNoOp = evaluated.filter((e) => e !== noOp);
  nonNoOp.sort((a, b) => b.scoreResult.totalScore - a.scoreResult.totalScore);

  const bestNonNoOp = nonNoOp[0];
  const winsBest =
    bestNonNoOp !== undefined &&
    bestNonNoOp.scoreResult.totalScore >
      noOp.scoreResult.totalScore + improvementThreshold;

  const winner: ScoredCandidate = winsBest ? bestNonNoOp : noOp;
  const proposal: CompositeAction | null = winsBest ? winner.action : null;

  // 5. Construir Explanation.
  // consideredAlternatives = top-K candidatas distintas de la ganadora,
  // ordenadas por score DESC (invariante I-14).
  const allOthers = evaluated.filter((e) => e !== winner);
  allOthers.sort((a, b) => b.scoreResult.totalScore - a.scoreResult.totalScore);
  const topAlternatives = allOthers.slice(0, topK);

  const consideredAlternatives: ReadonlyArray<ConsideredAlternative> =
    topAlternatives.map((alt) => ({
      action: alt.action,
      score: alt.scoreResult.totalScore,
      projectedKPIs: alt.projectedKPIs,
      discardReasonCode: deriveDiscardReasonCode(
        alt.scoreResult,
        noOp.scoreResult,
        improvementThreshold,
      ),
    }));

  const explanation: Explanation = {
    recommendedAction: winner.action,
    motiveCode: deriveMotiveCode(winner.action),
    consideredAlternatives,
    ifRejectedKPIs: noOp.projectedKPIs,
    projectedKPIs: winner.projectedKPIs,
  };

  return {
    proposal,
    explanation,
    autonomyLevel: "detailed_suggestion",
    autoExecutedActions: [],
  };
}

// =============================================================================
// Fallback decision (caso degenerado: no_op no evaluable)
// =============================================================================

function buildFallbackDecision(): CycleDecision {
  const emptyKPIs: KPIVector = {
    effectiveUtilization: 0,
    expectedOvertime: 0,
    meanWaitTime: 0,
    expectedForcedCancellations: 0,
    projectedBillableValue: 0,
    risk: 0,
  };
  return {
    proposal: null,
    explanation: {
      recommendedAction: NO_OP_ACTION,
      motiveCode: "RECOVERS_BILLABLE_VALUE",
      consideredAlternatives: [],
      ifRejectedKPIs: emptyKPIs,
      projectedKPIs: emptyKPIs,
    },
    autonomyLevel: "detailed_suggestion",
    autoExecutedActions: [],
  };
}
