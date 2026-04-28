/**
 * ORBITAL Core — Primitivas fundamentales
 * -----------------------------------------------------------------------------
 * Tipos universales que el motor maneja. El core razona sobre estos primitivos
 * sin conocer dominio (dental, hospital), idioma, moneda ni unidades temporales
 * concretas (no asume "slots de 30 min").
 *
 * Ver core-contract.md §3.
 */

/** Identificador opaco de recurso físico (sillón, sala, quirófano, box). */
export type ResourceId = string;

/** Identificador opaco de evento programado. */
export type EventId = string;

/** Identificador opaco de candidato en lista de espera. */
export type CandidateId = string;

/**
 * Instante en el tiempo, expresado como epoch milliseconds en UTC.
 * El core NUNCA maneja timezones. Toda conversión a TZ del tenant
 * vive en capa de presentación (ui/format.ts).
 *
 * Cierra estructuralmente INTL-3 e elimina la mitigación
 * TZ-MADRID-VERCEL aplicada en Sesión 8.
 */
export type InstantUTC = number;

/**
 * Duración en milisegundos.
 * El core NO conoce "slots". Los slots son una decisión de presentación.
 * Ejemplo: 30 min = 30 * 60 * 1000 = 1_800_000 ms.
 *
 * Cierra estructuralmente GRANULARITY-15MIN: el core acepta cualquier
 * granularidad temporal sin asumir slots de 30 min.
 */
export type DurationMs = number;

/**
 * Cantidad monetaria, cruda y sin moneda.
 * La moneda vive en metadata externa (Clinic.currency en Sesiones 12+).
 * El core asume que todos los valores de una ejecución están en la misma
 * moneda; responsabilidad del caller garantizarlo.
 */
export type MonetaryAmount = number;

/**
 * Ratio normalizado en [0, 1]. Usado para scores y sub-scores.
 * El core clampea valores fuera de rango con Math.max/min; no lanza error.
 */
export type ScoreRatio = number;