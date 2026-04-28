/**
 * ORBITAL Core — Tipos del dominio abstracto
 * -----------------------------------------------------------------------------
 * Estructuras que el core consume y produce. Sin vocabulario dental, sin
 * strings humanos, sin metadata de UI.
 *
 * Ver core-contract.md §4.
 */

import type {
  ResourceId,
  EventId,
  CandidateId,
  InstantUTC,
  DurationMs,
  MonetaryAmount,
  ScoreRatio,
} from "./primitives";

/**
 * Estado de un evento programado. Intencionadamente simple.
 * Si un vertical necesita más estados (ej: "in_progress", "billed"),
 * se añaden al enum, no se extienden por herencia.
 */
export type EventStatus = "confirmed" | "cancelled" | "delayed" | "suggested";

/**
 * Evento programado sobre un recurso.
 *
 * externalRefs es una bolsa opaca que el core NUNCA inspecciona.
 * La capa de dominio mete ahí patientId, treatmentId, dentistId, etc.
 * El core los preserva y los devuelve sin modificar.
 */
export type ScheduledEvent = {
  id: EventId;
  resourceId: ResourceId;
  start: InstantUTC;
  duration: DurationMs;
  status: EventStatus;
  value: MonetaryAmount;
  externalRefs: Readonly<Record<string, string>>;
};

/**
 * Candidato en lista de espera.
 * Todos los scores declarados (ease, priority) son ratios 0..1.
 * La conversión desde escala de dominio (ej: priority 1..5 en dental)
 * vive en capa de dominio (domains/dental.ts), no en core.
 */
export type WaitingCandidate = {
  id: CandidateId;
  requiredDuration: DurationMs;
  value: MonetaryAmount;
  preferredResourceId: ResourceId | null;
  availableNow: boolean;
  easeScore: ScoreRatio;
  priority: ScoreRatio;
  externalRefs: Readonly<Record<string, string>>;
};

/**
 * Hueco operativo detectado por el core.
 * gapType preparado para Fase 2 (huecos no solo por cancelación, también
 * naturales entre citas).
 */
export type Gap = {
  resourceId: ResourceId;
  start: InstantUTC;
  duration: DurationMs;
  lostValue: MonetaryAmount;
  sourceEventId: EventId;
  gapType: "cancelled" | "natural";
};

/**
 * Sub-scores que componen el totalScore. Auditable y explicable.
 */
export type ScoreBreakdown = {
  valueScore: ScoreRatio;
  fitScore: ScoreRatio;
  easeScore: ScoreRatio;
  availabilityScore: ScoreRatio;
  resourceScore: ScoreRatio;
  priorityScore: ScoreRatio;
};

/**
 * Códigos de explicación. Enum estricto.
 * La traducción a string humano vive en ui/i18n/{locale}.json.
 * Añadir nuevos códigos requiere actualizar todos los locales.
 */
export type ExplanationCode =
  | "FIT_EXACT"
  | "FIT_NEAR"
  | "FIT_LOOSE"
  | "RESOURCE_MATCH"
  | "RESOURCE_MISMATCH"
  | "RESOURCE_NEUTRAL"
  | "AVAILABILITY_IMMEDIATE"
  | "AVAILABILITY_LIMITED"
  | "VALUE_HIGH"
  | "VALUE_LOW"
  | "PRIORITY_HIGH"
  | "PRIORITY_LOW"
  | "EASE_HIGH"
  | "EASE_LOW";

/**
 * Candidato puntuado para un hueco concreto.
 * El breakdown es auditable y explicable sin strings.
 */
export type RankedCandidate = {
  candidateId: CandidateId;
  totalScore: ScoreRatio;
  breakdown: Readonly<ScoreBreakdown>;
  explanationCodes: ReadonlyArray<ExplanationCode>;
};

/**
 * Estado de la decisión humana sobre la sugerencia.
 */
export type DecisionState = "pending" | "accepted" | "rejected";

/**
 * Sugerencia: qué candidato cubre qué gap.
 */
export type Suggestion = {
  gapSourceEventId: EventId;
  candidateId: CandidateId;
  resourceId: ResourceId;
  start: InstantUTC;
  duration: DurationMs;
  value: MonetaryAmount;
};

/**
 * Resultado completo de una evaluación del motor.
 *
 * "gaps" puede contener múltiples huecos si la estrategia de detección
 * lo permite (ENGINE-MULTI-GAP del master). Para cada gap, hay una lista
 * rankeada de candidatos.
 *
 * "suggestions" es el mapping final: qué candidato llena qué gap.
 * Simple para Fase 1 (1 gap → top candidate), extensible para Fase 2+
 * (asignación multi-gap óptima vía algoritmo de matching).
 */
export type EngineResult = {
  gaps: ReadonlyArray<Gap>;
  rankingsByGap: ReadonlyMap<EventId, ReadonlyArray<RankedCandidate>>;
  suggestions: ReadonlyArray<Suggestion>;
  recoveredValue: MonetaryAmount;
  recoveredGapsCount: number;
  decision: DecisionState;
};