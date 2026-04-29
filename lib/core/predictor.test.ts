/**
 * Tests del Predictor (C1) — Sesión 12.
 *
 * 18 tests distribuidos:
 *  - predictDuration: 5
 *  - predictNoShow: 3
 *  - predictLateness: 3
 *  - predictAdviceAcceptance: 3
 *  - updateInProgress: 4
 *
 * Convención: las distribuciones de input están en MINUTOS, los outputs
 * del Predictor en MILISEGUNDOS. Cada test verifica explícitamente la
 * conversión cuando es relevante.
 *
 * Invariantes verificados (referencia: lib/core/types.test.ts):
 *  - I-8 DurationDistribution: mean > 0, stdDev >= 0, p10 <= p50 <= p90, p10 >= 0.
 *  - I-9 MinutesDistribution: stdDev >= 0, p10 <= p50 <= p90 (mean libre).
 */

import { describe, it, expect } from "vitest";
import {
  predictDuration,
  predictNoShow,
  predictLateness,
  predictAdviceAcceptance,
  updateInProgress,
  PRIOR_NO_SHOW_RATE,
  PRIOR_LATENESS_MEAN_MIN,
  PRIOR_LATENESS_STDDEV_MIN,
  PRIOR_LATENESS_P10_MIN,
  PRIOR_LATENESS_P50_MIN,
  PRIOR_LATENESS_P90_MIN,
  PRIOR_ADVICE_ACCEPTANCE,
  FINAL_PHASE_COMPRESSION_FACTOR,
} from "./predictor";
import type {
  DurationPredictionContext,
  InProgressContext,
  PatientPredictiveScores,
  ProcedureDistributions,
  ProcedureInfo,
  ProcedureActivationInfo,
} from "./predictor-types";

const MS_PER_MIN = 60 * 1000;

// =============================================================================
// Fixtures reutilizables
// =============================================================================

const refDist: ProcedureDistributions = {
  mean: 35,
  stdDev: 10,
  p10: 25,
  p50: 35,
  p90: 50,
};

const learnedDist: ProcedureDistributions = {
  mean: 40,
  stdDev: 12,
  p10: 28,
  p50: 40,
  p90: 58,
};

const procedureInfo: ProcedureInfo = {
  procedureId: "proc-1",
  referenceDistribution: refDist,
};

function buildContext(
  learned: ProcedureDistributions | null,
  proc: ProcedureInfo = procedureInfo,
): DurationPredictionContext {
  const activation: ProcedureActivationInfo = {
    procedureId: proc.procedureId,
    tenantId: "1",
    learnedDistribution: learned,
  };
  return { procedure: proc, activation };
}

const emptyScores: PatientPredictiveScores = {
  patientId: "p-1",
  noShowScore: null,
  latenessMeanMinutes: null,
  latenessStdDevMinutes: null,
  acceptAdviceScore: null,
};

// =============================================================================
// predictDuration (5 tests)
// =============================================================================

describe("predictDuration", () => {
  it("usa learnedDistribution cuando existe", () => {
    const out = predictDuration(buildContext(learnedDist));
    expect(out.mean).toBe(40 * MS_PER_MIN);
    expect(out.p50).toBe(40 * MS_PER_MIN);
    expect(out.p90).toBe(58 * MS_PER_MIN);
  });

  it("hace fallback a referenceDistribution cuando learnedDistribution es null", () => {
    const out = predictDuration(buildContext(null));
    expect(out.mean).toBe(35 * MS_PER_MIN);
    expect(out.p50).toBe(35 * MS_PER_MIN);
    expect(out.p90).toBe(50 * MS_PER_MIN);
  });

  it("convierte minutos a milisegundos en todos los campos", () => {
    const out = predictDuration(buildContext(learnedDist));
    expect(out.mean).toBe(learnedDist.mean * MS_PER_MIN);
    expect(out.stdDev).toBe(learnedDist.stdDev * MS_PER_MIN);
    expect(out.p10).toBe(learnedDist.p10 * MS_PER_MIN);
    expect(out.p50).toBe(learnedDist.p50 * MS_PER_MIN);
    expect(out.p90).toBe(learnedDist.p90 * MS_PER_MIN);
  });

  it("output cumple invariantes I-8 (mean > 0, stdDev >= 0, p10 <= p50 <= p90, p10 >= 0)", () => {
    const out = predictDuration(buildContext(learnedDist));
    expect(out.mean).toBeGreaterThan(0);
    expect(out.stdDev).toBeGreaterThanOrEqual(0);
    expect(out.p10).toBeGreaterThanOrEqual(0);
    expect(out.p10).toBeLessThanOrEqual(out.p50);
    expect(out.p50).toBeLessThanOrEqual(out.p90);
  });

  it("cold start (learned igual a reference) produce el mismo output que fallback", () => {
    const coldStart = predictDuration(buildContext(refDist));
    const fallback = predictDuration(buildContext(null));
    expect(coldStart).toEqual(fallback);
  });
});

// =============================================================================
// predictNoShow (3 tests)
// =============================================================================

describe("predictNoShow", () => {
  it("devuelve el score del paciente cuando existe", () => {
    const out = predictNoShow({ ...emptyScores, noShowScore: 0.18 });
    expect(out).toBe(0.18);
  });

  it("devuelve PRIOR_NO_SHOW_RATE cuando noShowScore es null", () => {
    const out = predictNoShow(emptyScores);
    expect(out).toBe(PRIOR_NO_SHOW_RATE);
  });

  it("clampa scores fuera de [0, 1]", () => {
    expect(predictNoShow({ ...emptyScores, noShowScore: -0.3 })).toBe(0);
    expect(predictNoShow({ ...emptyScores, noShowScore: 1.5 })).toBe(1);
  });
});

// =============================================================================
// predictLateness (3 tests)
// =============================================================================

describe("predictLateness", () => {
  it("devuelve distribución basada en datos cuando mean y stdDev existen", () => {
    const out = predictLateness({
      ...emptyScores,
      latenessMeanMinutes: 4,
      latenessStdDevMinutes: 6,
    });
    expect(out.mean).toBe(4 * MS_PER_MIN);
    expect(out.stdDev).toBe(6 * MS_PER_MIN);
    expect(out.p50).toBe(4 * MS_PER_MIN);
    // p10 = mean - 1.28*stdDev = 4 - 7.68 = -3.68 min
    expect(out.p10).toBeCloseTo(-3.68 * MS_PER_MIN, 0);
    // p90 = mean + 1.28*stdDev = 4 + 7.68 = 11.68 min
    expect(out.p90).toBeCloseTo(11.68 * MS_PER_MIN, 0);
  });

  it("devuelve distribución prior cuando faltan datos", () => {
    const out = predictLateness(emptyScores);
    expect(out.mean).toBe(PRIOR_LATENESS_MEAN_MIN * MS_PER_MIN);
    expect(out.stdDev).toBe(PRIOR_LATENESS_STDDEV_MIN * MS_PER_MIN);
    expect(out.p10).toBe(PRIOR_LATENESS_P10_MIN * MS_PER_MIN);
    expect(out.p50).toBe(PRIOR_LATENESS_P50_MIN * MS_PER_MIN);
    expect(out.p90).toBe(PRIOR_LATENESS_P90_MIN * MS_PER_MIN);
  });

  it("output cumple invariantes I-9 (stdDev >= 0, p10 <= p50 <= p90; mean libre)", () => {
    // Caso con datos
    const a = predictLateness({
      ...emptyScores,
      latenessMeanMinutes: -2,
      latenessStdDevMinutes: 3,
    });
    expect(a.stdDev).toBeGreaterThanOrEqual(0);
    expect(a.p10).toBeLessThanOrEqual(a.p50);
    expect(a.p50).toBeLessThanOrEqual(a.p90);

    // Caso prior
    const b = predictLateness(emptyScores);
    expect(b.stdDev).toBeGreaterThanOrEqual(0);
    expect(b.p10).toBeLessThanOrEqual(b.p50);
    expect(b.p50).toBeLessThanOrEqual(b.p90);

    // stdDev negativo en input se sanea a 0
    const c = predictLateness({
      ...emptyScores,
      latenessMeanMinutes: 5,
      latenessStdDevMinutes: -10,
    });
    expect(c.stdDev).toBe(0);
    expect(c.p10).toBe(c.p50);
    expect(c.p50).toBe(c.p90);
  });
});

// =============================================================================
// predictAdviceAcceptance (3 tests)
// =============================================================================

describe("predictAdviceAcceptance", () => {
  it("devuelve el score del paciente cuando existe", () => {
    const out = predictAdviceAcceptance({
      ...emptyScores,
      acceptAdviceScore: 0.72,
    });
    expect(out).toBe(0.72);
  });

  it("devuelve PRIOR_ADVICE_ACCEPTANCE cuando acceptAdviceScore es null", () => {
    const out = predictAdviceAcceptance(emptyScores);
    expect(out).toBe(PRIOR_ADVICE_ACCEPTANCE);
  });

  it("clampa scores fuera de [0, 1]", () => {
    expect(
      predictAdviceAcceptance({ ...emptyScores, acceptAdviceScore: -0.1 }),
    ).toBe(0);
    expect(
      predictAdviceAcceptance({ ...emptyScores, acceptAdviceScore: 2 }),
    ).toBe(1);
  });
});

// =============================================================================
// updateInProgress (4 tests)
// =============================================================================

describe("updateInProgress", () => {
  const phasedProcedure: ProcedureInfo = {
    procedureId: "proc-endo",
    referenceDistribution: refDist,
    orderedPhases: ["apertura", "instrumentacion", "obturacion"],
  };

  const previousDist: ProcedureDistributions = {
    mean: 60,
    stdDev: 15,
    p10: 45,
    p50: 60,
    p90: 80,
  };

  it("comprime la distribución cuando la fase completada es la última documentada", () => {
    const ctx: InProgressContext = {
      previousDistribution: previousDist,
      procedure: phasedProcedure,
      completedPhase: "obturacion",
    };
    const out = updateInProgress(ctx);
    const expectedMean =
      previousDist.mean * FINAL_PHASE_COMPRESSION_FACTOR * MS_PER_MIN;
    expect(out.mean).toBeCloseTo(expectedMean, 5);
    expect(out.p50).toBeCloseTo(
      previousDist.p50 * FINAL_PHASE_COMPRESSION_FACTOR * MS_PER_MIN,
      5,
    );
  });

  it("no cambia la distribución cuando la fase completada es intermedia", () => {
    const ctx: InProgressContext = {
      previousDistribution: previousDist,
      procedure: phasedProcedure,
      completedPhase: "instrumentacion",
    };
    const out = updateInProgress(ctx);
    expect(out.mean).toBe(previousDist.mean * MS_PER_MIN);
    expect(out.p50).toBe(previousDist.p50 * MS_PER_MIN);
    expect(out.p90).toBe(previousDist.p90 * MS_PER_MIN);
  });

  it("no cambia la distribución cuando el procedimiento no documenta fases", () => {
    const ctx: InProgressContext = {
      previousDistribution: previousDist,
      procedure: procedureInfo, // sin orderedPhases
      completedPhase: "cualquier_cosa",
    };
    const out = updateInProgress(ctx);
    expect(out.mean).toBe(previousDist.mean * MS_PER_MIN);
    expect(out.stdDev).toBe(previousDist.stdDev * MS_PER_MIN);
  });

  it("output cumple invariantes I-8 tras compresión", () => {
    const ctx: InProgressContext = {
      previousDistribution: previousDist,
      procedure: phasedProcedure,
      completedPhase: "obturacion",
    };
    const out = updateInProgress(ctx);
    expect(out.mean).toBeGreaterThan(0);
    expect(out.stdDev).toBeGreaterThanOrEqual(0);
    expect(out.p10).toBeGreaterThanOrEqual(0);
    expect(out.p10).toBeLessThanOrEqual(out.p50);
    expect(out.p50).toBeLessThanOrEqual(out.p90);
  });
});