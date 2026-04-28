/**
 * Primitivas tipadas del clean core agnóstico.
 * Sin dependencias externas. Compatible con cualquier vertical y locale.
 */

/** Identificador opaco de un recurso (gabinete, sala, equipamiento). */
export type ResourceId = string;

/** Identificador opaco de un evento agendado (cita, bloque, reserva). */
export type EventId = string;

/** Identificador opaco de un candidato en lista de espera. */
export type CandidateId = string;

/** Instante en tiempo: epoch ms en UTC. La conversión a TZ vive en ui/format.ts. */
export type InstantUTC = number;

/** Duración en milisegundos. Sin asumir slots ni granularidad. */
export type DurationMs = number;

/** Cantidad monetaria sin moneda. La moneda es metadata de tenant. */
export type MonetaryAmount = number;

/** Score normalizado entre 0 y 1. Validado en construcción. */
export type ScoreRatio = number;

export const SLOT_30_MIN_MS: DurationMs = 30 * 60 * 1000;
export const SLOT_15_MIN_MS: DurationMs = 15 * 60 * 1000;