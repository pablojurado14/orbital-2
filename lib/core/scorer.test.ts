/**
 * Tests del Scorer (C5) — Sesión 16.
 *
 * Cobertura: 14 tests:
 *   - scoreKPIs (combinación ponderada): 3
 *   - Penalización por varianza: 2
 *   - Cálculo de ChangeCost interno: 3
 *   - Penalización por coste de cambio: 2
 *   - score (integración): 3
 *   - Validación de pesos: 1
 */

import { describe, expect, it } from "vitest";
import type {
  CompositeAction,
  KPIVector,
  SimulationResult,
} from "./types";
import {
  computeChangeCost,
  score,
  scoreKPIs,
} from "./scorer";
import {
  DEFAULT_CHANGE_COST_COEFFICIENTS,
  DEFAULT_NORMALIZERS,
  DEFAULT_WEIGHTS,
  InvalidWeightsError,
  type ScoreWeights,
} from "./scorer-types";

// =============================================================================
// Fixtures
// =============================================================================

const ZERO_KPIS: KPIVector = {
  effectiveUtilization: 0,
  expectedOvertime: 0,
  meanWaitTime: 0,
  expectedForcedCancellations: 0,
  projectedBillableValue: 0,
  risk: 0,
};

function makeSimResult(
  expectedKPIs: KPIVector,
  varianceKPIs: KPIVector = ZERO_KPIS,
): SimulationResult {
  return {
    expectedKPIs,
    varianceKPIs,
    projectedEvents: [],
    criticalPoints: [],
  };
}

const NO_OP_ACTION: CompositeAction = [{ kind: "no_op" }];

// =============================================================================
// Tests — scoreKPIs (3)
// =============================================================================

describe("scoreKPIs", () => {
  it("devuelve subtotal 0 con todos los KPIs en cero", () => {
    const { contributions, subtotal } = scoreKPIs(
      ZERO_KPIS,
      DEFAULT_WEIGHTS,
      DEFAULT_NORMALIZERS,
    );
    expect(subtotal).toBeCloseTo(0, 5);
    expect(contributions.effectiveUtilization).toBeCloseTo(0, 5);
    expect(contributions.expectedOvertime).toBeCloseTo(0, 5);
    expect(contributions.projectedBillableValue).toBeCloseTo(0, 5);
  });

  it("aplica signos correctos: KPIs buenos suman, malos restan", () => {
    // KPIs en valores normalizados al máximo de su rango → cada contribución
    // debe igualar a ±weight × 1.
    const kpis: KPIVector = {
      effectiveUtilization: 1, // normalizado: 1/1 = 1
      expectedOvertime: 2 * 60 * 60_000, // 1 (full overtime)
      meanWaitTime: 30 * 60_000, // 1
      expectedForcedCancellations: 5, // 1
      projectedBillableValue: 3000, // 1
      risk: 0,
    };
    const { contributions } = scoreKPIs(
      kpis,
      DEFAULT_WEIGHTS,
      DEFAULT_NORMALIZERS,
    );
    expect(contributions.effectiveUtilization).toBeCloseTo(
      DEFAULT_WEIGHTS.effectiveUtilization,
      5,
    );
    expect(contributions.projectedBillableValue).toBeCloseTo(
      DEFAULT_WEIGHTS.projectedBillableValue,
      5,
    );
    expect(contributions.expectedOvertime).toBeCloseTo(
      -DEFAULT_WEIGHTS.expectedOvertime,
      5,
    );
    expect(contributions.meanWaitTime).toBeCloseTo(
      -DEFAULT_WEIGHTS.meanWaitTime,
      5,
    );
    expect(contributions.expectedForcedCancellations).toBeCloseTo(
      -DEFAULT_WEIGHTS.expectedForcedCancellations,
      5,
    );
  });

  it("respeta pesos sesgados: tenant que prioriza ingresos sobre todo", () => {
    // Pesos donde projectedBillableValue domina y el resto es residual.
    const weights: ScoreWeights = {
      effectiveUtilization: 0.05,
      expectedOvertime: 0.05,
      meanWaitTime: 0.05,
      expectedForcedCancellations: 0.05,
      projectedBillableValue: 0.8,
    };
    const kpis: KPIVector = {
      effectiveUtilization: 1,
      expectedOvertime: 0,
      meanWaitTime: 0,
      expectedForcedCancellations: 0,
      projectedBillableValue: 3000,
      risk: 0,
    };
    const { subtotal, contributions } = scoreKPIs(
      kpis,
      weights,
      DEFAULT_NORMALIZERS,
    );
    // projectedBillableValue contribuye 0.8 × 1 = 0.8
    // effectiveUtilization contribuye 0.05 × 1 = 0.05
    // total = 0.85
    expect(contributions.projectedBillableValue).toBeCloseTo(0.8, 5);
    expect(subtotal).toBeCloseTo(0.85, 5);
  });
});

// =============================================================================
// Tests — Penalización por varianza (2)
// =============================================================================

describe("penalización por varianza", () => {
  it("sin varianza, riskPenalty es 0", () => {
    const sim = makeSimResult(ZERO_KPIS);
    const result = score(sim, NO_OP_ACTION);
    expect(result.breakdown.riskPenalty).toBe(0);
  });

  it("varianza alta produce riskPenalty positiva proporcional", () => {
    const variance: KPIVector = {
      ...ZERO_KPIS,
      risk: 10,
    };
    const sim = makeSimResult(ZERO_KPIS, variance);
    const result = score(sim, NO_OP_ACTION);
    // riskPenalty default = 0.1 × 10 = 1.0
    expect(result.breakdown.riskPenalty).toBeCloseTo(1.0, 5);
  });
});

// =============================================================================
// Tests — Cálculo de ChangeCost interno (3)
// =============================================================================

describe("computeChangeCost", () => {
  it("no_op tiene coste cero", () => {
    const cost = computeChangeCost(
      NO_OP_ACTION,
      DEFAULT_CHANGE_COST_COEFFICIENTS,
    );
    expect(cost.totalCost).toBe(0);
    expect(cost.notifyPatientCount).toBe(0);
    expect(cost.reassignProfessionalCount).toBe(0);
    expect(cost.reassignResourceCount).toBe(0);
    expect(cost.otherPrimitiveCount).toBe(0);
  });

  it("una sola primitiva — postpone con notifyPatient cuenta como notify", () => {
    const action: CompositeAction = [
      {
        kind: "postpone",
        eventId: "e1",
        newStart: Date.UTC(2026, 4, 11, 10),
        notifyPatient: true,
      },
    ];
    const cost = computeChangeCost(action, DEFAULT_CHANGE_COST_COEFFICIENTS);
    expect(cost.notifyPatientCount).toBe(1);
    expect(cost.otherPrimitiveCount).toBe(0);
    expect(cost.totalCost).toBeCloseTo(
      DEFAULT_CHANGE_COST_COEFFICIENTS.notifyPatient,
      5,
    );
  });

  it("multi-primitiva combina coeficientes correctamente", () => {
    // 1 reassign_professional (0.8) + 1 reassign_resource (0.3) +
    // 1 postpone con notify (1.0) + 1 move (0.2 = otherPrimitive) = 2.3.
    const action: CompositeAction = [
      {
        kind: "reassign_professional",
        eventId: "e1",
        newProfessionalId: "prof_b",
      },
      {
        kind: "reassign_resource",
        eventId: "e2",
        resourceKind: "room",
        newResourceId: "room_2",
      },
      {
        kind: "postpone",
        eventId: "e3",
        newStart: Date.UTC(2026, 4, 11, 11),
        notifyPatient: true,
      },
      {
        kind: "move",
        eventId: "e4",
        newStart: Date.UTC(2026, 4, 11, 12),
        newResourceId: "room_3",
      },
    ];
    const cost = computeChangeCost(action, DEFAULT_CHANGE_COST_COEFFICIENTS);
    expect(cost.reassignProfessionalCount).toBe(1);
    expect(cost.reassignResourceCount).toBe(1);
    expect(cost.notifyPatientCount).toBe(1);
    expect(cost.otherPrimitiveCount).toBe(1);
    expect(cost.totalCost).toBeCloseTo(0.8 + 0.3 + 1.0 + 0.2, 5);
  });
});

// =============================================================================
// Tests — Penalización por coste de cambio (2)
// =============================================================================

describe("penalización por coste de cambio", () => {
  it("no_op produce changeCostPenalty cero", () => {
    const sim = makeSimResult(ZERO_KPIS);
    const result = score(sim, NO_OP_ACTION);
    expect(result.breakdown.changeCostPenalty).toBe(0);
    expect(result.breakdown.changeCostBreakdown.totalCost).toBe(0);
  });

  it("acción con varias primitivas produce changeCostPenalty proporcional", () => {
    const action: CompositeAction = [
      {
        kind: "reassign_professional",
        eventId: "e1",
        newProfessionalId: "prof_b",
      },
      {
        kind: "postpone",
        eventId: "e2",
        newStart: Date.UTC(2026, 4, 11, 11),
        notifyPatient: true,
      },
    ];
    const sim = makeSimResult(ZERO_KPIS);
    const result = score(sim, action);
    // totalCost = 0.8 + 1.0 = 1.8
    // changeCostPenalty = 0.05 × 1.8 = 0.09
    expect(result.breakdown.changeCostBreakdown.totalCost).toBeCloseTo(1.8, 5);
    expect(result.breakdown.changeCostPenalty).toBeCloseTo(0.09, 5);
  });
});

// =============================================================================
// Tests — score (integración) (3)
// =============================================================================

describe("score (integración)", () => {
  it("no_op sobre KPIs cero produce totalScore cero", () => {
    const sim = makeSimResult(ZERO_KPIS);
    const result = score(sim, NO_OP_ACTION);
    expect(result.totalScore).toBe(0);
    expect(result.breakdown.kpiSubtotal).toBe(0);
    expect(result.breakdown.riskPenalty).toBe(0);
    expect(result.breakdown.changeCostPenalty).toBe(0);
  });

  it("candidata con KPIs buenos domina sobre no_op", () => {
    // Candidata con buenos KPIs pero con coste de cambio.
    const goodKPIs: KPIVector = {
      effectiveUtilization: 0.8,
      expectedOvertime: 0,
      meanWaitTime: 0,
      expectedForcedCancellations: 0,
      projectedBillableValue: 1500,
      risk: 0,
    };
    const action: CompositeAction = [
      {
        kind: "fill_from_waitlist",
        waitingCandidateId: "wc1",
        gapStart: Date.UTC(2026, 4, 11, 10),
        gapResourceId: "room_1",
        proposedDuration: 30 * 60_000,
      },
    ];
    const candidate = score(makeSimResult(goodKPIs), action);
    const noOp = score(makeSimResult(ZERO_KPIS), NO_OP_ACTION);
    expect(candidate.totalScore).toBeGreaterThan(noOp.totalScore);
  });

  it("candidata con mismo expected pierde frente a la de menor varianza", () => {
    const sameExpectedKPIs: KPIVector = {
      effectiveUtilization: 0.5,
      expectedOvertime: 0,
      meanWaitTime: 0,
      expectedForcedCancellations: 0,
      projectedBillableValue: 1000,
      risk: 0,
    };
    const lowVariance: KPIVector = { ...ZERO_KPIS, risk: 1 };
    const highVariance: KPIVector = { ...ZERO_KPIS, risk: 20 };
    const candA = score(makeSimResult(sameExpectedKPIs, lowVariance), NO_OP_ACTION);
    const candB = score(makeSimResult(sameExpectedKPIs, highVariance), NO_OP_ACTION);
    expect(candA.totalScore).toBeGreaterThan(candB.totalScore);
  });
});

// =============================================================================
// Tests — Validación de pesos (1)
// =============================================================================

describe("validación de pesos", () => {
  it("pesos que no suman 1.0 lanzan InvalidWeightsError", () => {
    const badWeights: ScoreWeights = {
      effectiveUtilization: 0.5,
      expectedOvertime: 0.5,
      meanWaitTime: 0.5,
      expectedForcedCancellations: 0,
      projectedBillableValue: 0,
    };
    const sim = makeSimResult(ZERO_KPIS);
    expect(() => score(sim, NO_OP_ACTION, { weights: badWeights })).toThrow(
      InvalidWeightsError,
    );
  });
});