import type { DurationMs, ScoreRatio } from "./primitives";
import { SLOT_30_MIN_MS } from "./primitives";

export interface EngineWeights {
  readonly value: ScoreRatio;
  readonly fit: ScoreRatio;
  readonly ease: ScoreRatio;
  readonly availability: ScoreRatio;
  readonly resource: ScoreRatio;
  readonly priority: ScoreRatio;
}

export interface FitConfig {
  readonly baseSlotUnit: DurationMs;
  readonly exactBonus: ScoreRatio;
  readonly nearBonus: ScoreRatio;
  readonly looseBonus: ScoreRatio;
  readonly nearToleranceMs: DurationMs;
}

export interface AvailabilityConfig {
  readonly highWhenAvailable: ScoreRatio;
  readonly lowWhenUnavailable: ScoreRatio;
}

export interface ResourceConfig {
  readonly matchOrNeutral: ScoreRatio;
  readonly mismatch: ScoreRatio;
}

export type GapDetectionStrategy = "first_cancelled" | "all_cancelled";

export interface EngineConfig {
  readonly weights: EngineWeights;
  readonly fit: FitConfig;
  readonly availability: AvailabilityConfig;
  readonly resource: ResourceConfig;
  readonly gapDetection: GapDetectionStrategy;
}

export const DEFAULT_CONFIG: EngineConfig = {
  weights: {
    value: 0.30,
    fit: 0.25,
    ease: 0.20,
    availability: 0.10,
    resource: 0.05,
    priority: 0.10,
  },
  fit: {
    baseSlotUnit: SLOT_30_MIN_MS,
    exactBonus: 1.0,
    nearBonus: 0.7,
    looseBonus: 0.4,
    nearToleranceMs: 1,
  },
  availability: {
    highWhenAvailable: 1.0,
    lowWhenUnavailable: 0.2,
  },
  resource: {
    matchOrNeutral: 1.0,
    mismatch: 0.5,
  },
  gapDetection: "first_cancelled",
};

const WEIGHTS_SUM_TOLERANCE = 0.001;

export function validateConfig(cfg: EngineConfig): void {
  const w = cfg.weights;
  for (const [key, val] of Object.entries(w)) {
    if (val < 0) {
      throw new Error(`EngineConfig.weights.${key} no puede ser negativo: ${val}`);
    }
  }
  const sum = w.value + w.fit + w.ease + w.availability + w.resource + w.priority;
  if (Math.abs(sum - 1.0) > WEIGHTS_SUM_TOLERANCE) {
    throw new Error(
      `EngineConfig.weights debe sumar 1.0 (±${WEIGHTS_SUM_TOLERANCE}). Suma actual: ${sum}`
    );
  }
}

export function defaultComputeFit(
  candidateDuration: number,
  gapDuration: number,
  cfg: FitConfig
): ScoreRatio {
  if (candidateDuration > gapDuration) return 0;
  const diff = gapDuration - candidateDuration;
  const TOLERANCE = 1e-6;
  if (diff <= cfg.nearToleranceMs) return cfg.exactBonus;
  if (diff <= cfg.baseSlotUnit + TOLERANCE) return cfg.nearBonus;
  return cfg.looseBonus;
}