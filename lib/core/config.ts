/**
 * ORBITAL Core — Configuración
 * -----------------------------------------------------------------------------
 * EngineConfig inyectable, DEFAULT_CONFIG con los pesos de v7.3, y validación
 * de invariante de pesos (sum = 1.0 ± 0.001).
 *
 * Cierra estructuralmente CLEAN-CORE-5 (acoplamiento unidades) al exponer
 * `baseSlotUnit` como configuración por vertical. Cierra parcialmente
 * CLEAN-CORE-6 al desacoplar tipos del core de @/data/mock.
 *
 * Ver core-contract.md §6.
 */

import type { DurationMs, ScoreRatio } from "./primitives";

/**
 * Pesos del scoring. Suma debe ser 1.0 ± 0.001.
 * Defaults heredados de motor v7.3 (master §6).
 */
export type ScoringWeights = {
  value: ScoreRatio;
  fit: ScoreRatio;
  ease: ScoreRatio;
  availability: ScoreRatio;
  resource: ScoreRatio;
  priority: ScoreRatio;
};

/**
 * Estrategia de detección de gaps.
 *
 * - "first_cancelled": legacy v7.3, solo el primer cancelled del horizonte.
 * - "all_cancelled": resuelve ENGINE-MULTI-GAP, todos los cancelled.
 * - "all_cancelled_plus_natural": Fase 2+, también huecos entre citas.
 */
export type GapDetectionStrategy =
  | "first_cancelled"
  | "all_cancelled"
  | "all_cancelled_plus_natural";

/**
 * Estrategia de fit (encaje de duración candidato/hueco).
 * Configurable porque cada vertical tiene tolerancias distintas
 * (dental: tolerancia baja; fisio: media; hospital: depende de procedimiento).
 */
export type FitStrategy = {
  /**
   * Mapea (gapDuration, candidateDuration, baseUnit) → ScoreRatio en [0, 1].
   * candidateDuration > gapDuration debe devolver 0 (defensa contra
   * llamadas con candidatos no filtrados).
   */
  computeFit: (
    gapMs: DurationMs,
    candidateMs: DurationMs,
    unit: DurationMs,
  ) => ScoreRatio;
  /**
   * Unidad base para "1 unidad de margen" en el cálculo de fit.
   * Default dental: 30 min en ms. Configurable por vertical.
   */
  baseSlotUnit: DurationMs;
};

export type EngineConfig = {
  weights: ScoringWeights;
  gapDetection: GapDetectionStrategy;
  fit: FitStrategy;
  /**
   * Si un candidato no cabe en ningún hueco (requiredDuration > gap.duration),
   * ¿se descarta o se acepta con penalty?
   * Default v7.3: "hard_filter" (descarte).
   */
  oversizeHandling: "hard_filter" | "soft_penalty";
};

/**
 * Función fit por defecto. Replica el comportamiento numérico de v7.3
 * (`fitScoreForDurationDiff` en lib/orbital-engine.ts):
 *
 * - candidateMs > gapMs → 0    (no cabe; defensivo, normalmente filtrado antes)
 * - diff exacto         → 1.0  (encaje exacto)
 * - diff <= 1 unidad    → 0.7  (un slot/unidad de margen)
 * - diff > 1 unidad     → 0.4  (margen mayor)
 *
 * Tolerancia de 1e-6 en comparaciones para defenderse contra
 * imprecisiones de floating-point al dividir ms por unit.
 */
export function defaultComputeFit(
  gapMs: DurationMs,
  candidateMs: DurationMs,
  unit: DurationMs,
): ScoreRatio {
  if (candidateMs > gapMs) return 0;
  const diffUnits = (gapMs - candidateMs) / unit;
  if (diffUnits <= 1e-6) return 1.0;
  if (diffUnits <= 1 + 1e-6) return 0.7;
  return 0.4;
}

/**
 * Configuración por defecto. Heredada de v7.3 para fidelidad numérica
 * con el motor anterior (invariante §9.7 del contrato).
 */
export const DEFAULT_CONFIG: EngineConfig = {
  weights: {
    value: 0.3,
    fit: 0.25,
    ease: 0.2,
    availability: 0.1,
    resource: 0.05,
    priority: 0.1,
  },
  gapDetection: "first_cancelled",
  fit: {
    computeFit: defaultComputeFit,
    baseSlotUnit: 30 * 60 * 1000,
  },
  oversizeHandling: "hard_filter",
};

/**
 * Valida que la configuración respeta los invariantes del contrato §6.1:
 * - Todos los pesos >= 0.
 * - sum(weights) === 1.0 ± 0.001.
 *
 * Lanza Error si la config es inválida. Único error que el core lanza:
 * config inválida es bug del caller, datos inválidos no.
 */
export function validateConfig(config: EngineConfig): void {
  const w = config.weights;

  if (
    w.value < 0 ||
    w.fit < 0 ||
    w.ease < 0 ||
    w.availability < 0 ||
    w.resource < 0 ||
    w.priority < 0
  ) {
    throw new Error("EngineConfig inválida: ningún peso puede ser negativo.");
  }

  const sum =
    w.value + w.fit + w.ease + w.availability + w.resource + w.priority;

  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(
      `EngineConfig inválida: la suma de los pesos debe ser 1.0 ± 0.001 (actual: ${sum.toFixed(6)}).`,
    );
  }
}