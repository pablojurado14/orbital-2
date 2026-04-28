/**
 * ORBITAL Core — Tests de invariantes de los tipos del modelo mental
 * -----------------------------------------------------------------------------
 * Cubre los invariantes documentados en core-contract.md v2.0 §12.2:
 *  - DurationDistribution: mean > 0, stdDev >= 0, p10 >= 0, p10 <= p50 <= p90
 *  - MinutesDistribution: stdDev >= 0, p10 <= p50 <= p90 (mean libre)
 *  - CompositeAction: validateCompositionCoherence detecta vacías, duplicados,
 *    conflictos mutuamente excluyentes, no_op coexistiendo con otras.
 *  - Explanation: alternativas ordenadas por score descendente.
 *  - VectorKPIs: estructura completa.
 */

import { describe, it, expect } from "vitest";
import {
  validateCompositionCoherence,
  type CompositeAction,
  type ConsideredAlternative,
  type DurationDistribution,
  type Explanation,
  type KPIVector,
  type MinutesDistribution,
} from "./types";

const MIN = 60 * 1000;

// -----------------------------------------------------------------------------
// Helpers locales — invariantes inline (sin helpers exportados del core,
// las invariantes viven como contrato documentado en docs/core-contract.md).
// -----------------------------------------------------------------------------

function isValidDurationDistribution(d: DurationDistribution): boolean {
  return d.mean > 0
    && d.stdDev >= 0
    && d.p10 >= 0
    && d.p10 <= d.p50
    && d.p50 <= d.p90;
}

function isValidMinutesDistribution(d: MinutesDistribution): boolean {
  return d.stdDev >= 0
    && d.p10 <= d.p50
    && d.p50 <= d.p90;
}

function alternativesOrderedByScoreDesc(e: Explanation): boolean {
  const alts = e.consideredAlternatives;
  for (let i = 1; i < alts.length; i++) {
    if (alts[i - 1].score < alts[i].score) return false;
  }
  return true;
}

const DEFAULT_KPI: KPIVector = {
  effectiveUtilization: 0.8,
  expectedOvertime: 0,
  meanWaitTime: 0,
  expectedForcedCancellations: 0,
  projectedBillableValue: 0,
  risk: 0,
};

function makeAlternative(score: number): ConsideredAlternative {
  return {
    action: [{ kind: "no_op" }],
    score,
    projectedKPIs: DEFAULT_KPI,
    discardReasonCode: "DOMINATED_BY_ALTERNATIVE",
  };
}

// =============================================================================
// 1. DurationDistribution
// =============================================================================

describe("DurationDistribution — invariantes", () => {
  it("válida con percentiles ordenados y mean positivo", () => {
    const d: DurationDistribution = {
      mean: 30 * MIN,
      stdDev: 5 * MIN,
      p10: 20 * MIN,
      p50: 30 * MIN,
      p90: 45 * MIN,
    };
    expect(isValidDurationDistribution(d)).toBe(true);
  });

  it("inválida cuando p10 > p50", () => {
    const d: DurationDistribution = {
      mean: 30 * MIN, stdDev: 5 * MIN,
      p10: 35 * MIN, p50: 30 * MIN, p90: 45 * MIN,
    };
    expect(isValidDurationDistribution(d)).toBe(false);
  });

  it("inválida cuando p50 > p90", () => {
    const d: DurationDistribution = {
      mean: 30 * MIN, stdDev: 5 * MIN,
      p10: 20 * MIN, p50: 50 * MIN, p90: 45 * MIN,
    };
    expect(isValidDurationDistribution(d)).toBe(false);
  });

  it("inválida cuando mean es 0 o negativo", () => {
    const zero: DurationDistribution = {
      mean: 0, stdDev: 5 * MIN,
      p10: 20 * MIN, p50: 30 * MIN, p90: 45 * MIN,
    };
    expect(isValidDurationDistribution(zero)).toBe(false);
  });

  it("inválida cuando p10 es negativo (la duración no puede ser negativa)", () => {
    const d: DurationDistribution = {
      mean: 30 * MIN, stdDev: 5 * MIN,
      p10: -1, p50: 30 * MIN, p90: 45 * MIN,
    };
    expect(isValidDurationDistribution(d)).toBe(false);
  });
});

// =============================================================================
// 2. MinutesDistribution (permite mean negativo)
// =============================================================================

describe("MinutesDistribution — invariantes", () => {
  it("válida con mean negativo (paciente llega antes)", () => {
    const d: MinutesDistribution = {
      mean: -3 * MIN, stdDev: 2 * MIN,
      p10: -8 * MIN, p50: -3 * MIN, p90: 1 * MIN,
    };
    expect(isValidMinutesDistribution(d)).toBe(true);
  });

  it("inválida cuando stdDev es negativo", () => {
    const d: MinutesDistribution = {
      mean: 0, stdDev: -1,
      p10: -5 * MIN, p50: 0, p90: 5 * MIN,
    };
    expect(isValidMinutesDistribution(d)).toBe(false);
  });

  it("inválida cuando percentiles no están ordenados", () => {
    const d: MinutesDistribution = {
      mean: 0, stdDev: 2 * MIN,
      p10: 5 * MIN, p50: 0, p90: 10 * MIN,
    };
    expect(isValidMinutesDistribution(d)).toBe(false);
  });
});

// =============================================================================
// 3. CompositeAction — validateCompositionCoherence
// =============================================================================

describe("validateCompositionCoherence", () => {
  it("composición vacía es inválida con código EMPTY_COMPOSITION", () => {
    const r = validateCompositionCoherence([]);
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("EMPTY_COMPOSITION");
  });

  it("composición [no_op] es válida (decisión explícita de no actuar)", () => {
    const c: CompositeAction = [{ kind: "no_op" }];
    const r = validateCompositionCoherence(c);
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("composición coherente sobre eventos distintos es válida", () => {
    const c: CompositeAction = [
      { kind: "move", eventId: "ev-1", newStart: 0, newResourceId: "gab-1" },
      { kind: "postpone", eventId: "ev-2", newStart: 0, notifyPatient: true },
      {
        kind: "fill_from_waitlist",
        waitingCandidateId: "cand-1",
        gapStart: 0,
        gapResourceId: "gab-2",
        proposedDuration: 30 * MIN,
      },
    ];
    expect(validateCompositionCoherence(c).valid).toBe(true);
  });

  it("no_op no puede coexistir con otras primitivas", () => {
    const c: CompositeAction = [
      { kind: "no_op" },
      { kind: "move", eventId: "ev-1", newStart: 0, newResourceId: "gab-1" },
    ];
    const r = validateCompositionCoherence(c);
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("NO_OP_WITH_OTHER_ACTIONS");
  });

  it("misma primitiva sobre el mismo evento es duplicado", () => {
    const c: CompositeAction = [
      { kind: "move", eventId: "ev-1", newStart: 0, newResourceId: "gab-1" },
      { kind: "move", eventId: "ev-1", newStart: 1000, newResourceId: "gab-2" },
    ];
    const r = validateCompositionCoherence(c);
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("DUPLICATE_PRIMITIVE_ON_EVENT");
  });

  it("move + cancel_and_reschedule sobre mismo evento → conflicto", () => {
    const c: CompositeAction = [
      { kind: "move", eventId: "ev-1", newStart: 0, newResourceId: "gab-1" },
      { kind: "cancel_and_reschedule", eventId: "ev-1" },
    ];
    const r = validateCompositionCoherence(c);
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("CONFLICTING_PRIMITIVES_ON_EVENT");
  });

  it("advance + postpone sobre mismo evento → conflicto", () => {
    const c: CompositeAction = [
      { kind: "advance", eventId: "ev-1", newStart: 0 },
      { kind: "postpone", eventId: "ev-1", newStart: 1000, notifyPatient: false },
    ];
    expect(validateCompositionCoherence(c).valid).toBe(false);
  });

  it("compress + expand sobre mismo evento → conflicto", () => {
    const c: CompositeAction = [
      { kind: "compress", eventId: "ev-1", newDuration: 15 * MIN },
      { kind: "expand", eventId: "ev-1", newDuration: 60 * MIN },
    ];
    expect(validateCompositionCoherence(c).valid).toBe(false);
  });

  it("misma primitiva sobre eventos distintos NO es conflicto", () => {
    const c: CompositeAction = [
      { kind: "move", eventId: "ev-1", newStart: 0, newResourceId: "gab-1" },
      { kind: "move", eventId: "ev-2", newStart: 0, newResourceId: "gab-2" },
    ];
    expect(validateCompositionCoherence(c).valid).toBe(true);
  });

  it("issue de duplicado o conflicto referencia el eventId afectado", () => {
    const c: CompositeAction = [
      { kind: "move", eventId: "ev-x", newStart: 0, newResourceId: "gab-1" },
      { kind: "cancel_and_reschedule", eventId: "ev-x" },
    ];
    const r = validateCompositionCoherence(c);
    const conflict = r.issues.find((i) => i.code === "CONFLICTING_PRIMITIVES_ON_EVENT");
    expect(conflict?.affectedEventId).toBe("ev-x");
  });
});

// =============================================================================
// 4. Explanation — alternativas ordenadas por score descendente
// =============================================================================

describe("Explanation — alternativas ordenadas por score descendente", () => {
  it("válida cuando alternativas están en orden descendente", () => {
    const e: Explanation = {
      recommendedAction: [{ kind: "no_op" }],
      motiveCode: "REDUCES_WAIT_TIME",
      consideredAlternatives: [
        makeAlternative(0.9),
        makeAlternative(0.5),
        makeAlternative(0.1),
      ],
      ifRejectedKPIs: DEFAULT_KPI,
      projectedKPIs: DEFAULT_KPI,
    };
    expect(alternativesOrderedByScoreDesc(e)).toBe(true);
  });

  it("inválida cuando alternativas no están ordenadas", () => {
    const e: Explanation = {
      recommendedAction: [{ kind: "no_op" }],
      motiveCode: "REDUCES_WAIT_TIME",
      consideredAlternatives: [
        makeAlternative(0.5),
        makeAlternative(0.9),  // mayor que la anterior — viola invariante
        makeAlternative(0.1),
      ],
      ifRejectedKPIs: DEFAULT_KPI,
      projectedKPIs: DEFAULT_KPI,
    };
    expect(alternativesOrderedByScoreDesc(e)).toBe(false);
  });

  it("vacía o de un solo elemento es trivialmente ordenada", () => {
    const empty: Explanation = {
      recommendedAction: [{ kind: "no_op" }],
      motiveCode: "REDUCES_WAIT_TIME",
      consideredAlternatives: [],
      ifRejectedKPIs: DEFAULT_KPI,
      projectedKPIs: DEFAULT_KPI,
    };
    expect(alternativesOrderedByScoreDesc(empty)).toBe(true);
  });
});

// =============================================================================
// 5. KPIVector — estructura completa
// =============================================================================

describe("KPIVector — estructura", () => {
  it("acepta los 6 campos requeridos del modelo mental", () => {
    const k: KPIVector = {
      effectiveUtilization: 0.85,
      expectedOvertime: 12 * MIN,
      meanWaitTime: 5 * MIN,
      expectedForcedCancellations: 0.3,
      projectedBillableValue: 1450,
      risk: 0.18,
    };
    // Si compila y los valores son los que pusimos, la estructura está OK.
    expect(k.effectiveUtilization).toBe(0.85);
    expect(k.expectedOvertime).toBe(12 * MIN);
    expect(k.meanWaitTime).toBe(5 * MIN);
    expect(k.expectedForcedCancellations).toBe(0.3);
    expect(k.projectedBillableValue).toBe(1450);
    expect(k.risk).toBe(0.18);
  });
});