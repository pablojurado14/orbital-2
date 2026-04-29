/**
 * Tipos del Generator (C3) — Sesión 14.
 *
 * Inputs estructurales que el Generator necesita: trigger que dispara la
 * generación + contexto de datos que necesita para producir candidatas viables.
 *
 * El Generator es función pura. Recibe estos tipos por argumento y devuelve
 * ReadonlyArray<CompositeAction>. La capa adapter (Coordinator, Sesión 17)
 * traduce eventos de DB a triggers y carga los datos en GenerationContext.
 *
 * Documento de referencia: logica-reoptimizacion-saas.md §10 C3 + §11 eventos.
 */

import type {
  Gap,
  WaitingCandidate,
  DurationDistribution,
} from "./types";
import type {
  EventId,
  ResourceId,
  InstantUTC,
  DurationMs,
} from "./primitives";
import type { ValidationContext } from "./validator";

// =============================================================================
// Trigger — qué hace que el Generator se invoque
// =============================================================================

export interface GapDetectedTrigger {
  readonly kind: "gap_detected";
  readonly gap: Gap;
}

export interface OverrunPropagationTrigger {
  readonly kind: "overrun_propagation";
  readonly originEventId: EventId;
  readonly estimatedSlippage: DurationMs;
  readonly affectedDownstreamEventIds: ReadonlyArray<EventId>;
}

export interface NoShowTrigger {
  readonly kind: "no_show";
  readonly eventId: EventId;
}

export interface ProfessionalUnavailableTrigger {
  readonly kind: "professional_unavailable";
  readonly professionalId: ResourceId;
  readonly rangeStart: InstantUTC;
  readonly rangeEnd: InstantUTC;
}

export interface ProactiveSweepTrigger {
  readonly kind: "proactive_sweep";
}

export type GenerationTrigger =
  | GapDetectedTrigger
  | OverrunPropagationTrigger
  | NoShowTrigger
  | ProfessionalUnavailableTrigger
  | ProactiveSweepTrigger;

// =============================================================================
// Contexto del Generator
// =============================================================================

export interface WaitlistContext {
  readonly candidates: ReadonlyArray<WaitingCandidate>;
}

export interface GenerationContext {
  readonly validation: ValidationContext;
  readonly waitlist: WaitlistContext;
  readonly estimatedDistributionByProcedureId?: Record<ResourceId, DurationDistribution>;
}

// =============================================================================
// Configuración de generación
// =============================================================================

export interface GenerationOptions {
  readonly budgetMs?: number;
  readonly maxCandidates?: number;
}