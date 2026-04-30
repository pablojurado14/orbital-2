/**
 * Tests del Coordinator (C6) — Sesión 17.
 *
 * Cobertura: 16 tests:
 *   - Mapeo EngineEvent → GenerationTrigger: 4
 *   - Eventos sin trigger directo: 1
 *   - Selección de ganadora: 4
 *   - Construcción de Explanation: 4
 *   - Política de autonomía v1: 1
 *   - Integración end-to-end: 2
 */

import { describe, expect, it } from "vitest";
import type {
  AppointmentState,
  CancellationEvent,
  CompositeAction,
  DayState,
  DurationDistribution,
  EngineEvent,
  KPIVector,
  ProactiveTickEvent,
} from "./types";
import type { EventId, InstantUTC, ResourceId } from "./primitives";
import type {
  AppointmentRuntime,
  AppointmentRuntimeMap,
} from "./state-transitions";
import type {
  EquipmentInfo,
  ProcedureRequirements,
  ProfessionalCapabilities,
  WorkSchedule,
} from "./domain-types";
import type { CoordinatorContexts, CoordinatorOptions } from "./coordinator-types";
import {
  deriveDiscardReasonCode,
  deriveMotiveCode,
  inferTrigger,
  runCycle,
} from "./coordinator";
import type { ScoreResult } from "./scorer-types";

// =============================================================================
// Fixtures base
// =============================================================================

const DAY_BASE: InstantUTC = Date.UTC(2026, 4, 11);

function at(hh: number, mm = 0): InstantUTC {
  return DAY_BASE + (hh * 60 + mm) * 60_000;
}

const MS_30_MIN = 30 * 60_000;
const MS_60_MIN = 60 * 60_000;

const SCHEDULE_MON_FULL: WorkSchedule = {
  "1": {
    morningOpen: "09:00",
    morningClose: "13:00",
    afternoonOpen: "15:00",
    afternoonClose: "19:00",
  },
};

const PROF_A: ProfessionalCapabilities = {
  professionalId: "prof_a",
  capabilities: { general_dentistry: 1 },
  workSchedule: SCHEDULE_MON_FULL,
  hourlyCost: 50,
};

const PROF_B: ProfessionalCapabilities = {
  professionalId: "prof_b",
  capabilities: { general_dentistry: 1 },
  workSchedule: SCHEDULE_MON_FULL,
  hourlyCost: 50,
};

const PROC_GENERIC: ProcedureRequirements = {
  procedureId: "proc_generic",
  procedureCode: "GEN",
  requiresProfessionalCapabilities: ["general_dentistry"],
  requiresRoomCapabilities: [],
  requiresEquipment: [],
  requiresAuxiliary: false,
  precondition: null,
};

const EQUIPMENT_NONE: ReadonlyArray<EquipmentInfo> = [];

function distDeterministic(d: number): DurationDistribution {
  return { mean: d, stdDev: 0, p10: d, p50: d, p90: d };
}

function dist(p10: number, p50: number, p90: number): DurationDistribution {
  return { mean: p50, stdDev: 0, p10, p50, p90 };
}

function apt(
  eventId: EventId,
  options: {
    estimatedEndDistribution?: DurationDistribution;
    overrunProbability?: number;
    noShowProbability?: number;
    significantLatenessProbability?: number;
    runtimeStatus?: AppointmentState["runtimeStatus"];
  } = {},
): AppointmentState {
  return {
    eventId,
    runtimeStatus: options.runtimeStatus ?? "scheduled",
    estimatedEndDistribution:
      options.estimatedEndDistribution ?? distDeterministic(MS_30_MIN),
    detectedRisks: {
      overrunProbability: options.overrunProbability ?? 0,
      noShowProbability: options.noShowProbability ?? 0,
      significantLatenessProbability:
        options.significantLatenessProbability ?? 0,
    },
  };
}

function runtime(
  eventId: EventId,
  options: {
    professionalId?: ResourceId;
    roomId?: ResourceId;
    start?: InstantUTC;
    plannedDuration?: number;
    procedureId?: ResourceId;
    patientId?: ResourceId;
  } = {},
): AppointmentRuntime {
  return {
    eventId,
    professionalId: options.professionalId ?? "prof_a",
    roomId: options.roomId ?? "room_1",
    start: options.start ?? at(9),
    plannedDuration: options.plannedDuration ?? MS_30_MIN,
    procedureId: options.procedureId ?? "proc_generic",
    patientId: options.patientId ?? "patient_x",
    reservedEquipment: [],
  };
}

const EMPTY_KPIS: KPIVector = {
  effectiveUtilization: 0,
  expectedOvertime: 0,
  meanWaitTime: 0,
  expectedForcedCancellations: 0,
  projectedBillableValue: 0,
  risk: 0,
};

function makeState(appointments: ReadonlyArray<AppointmentState>): DayState {
  return {
    tenantId: "test_tenant",
    date: DAY_BASE,
    currentInstant: at(9),
    rooms: [],
    professionals: [],
    equipment: [],
    appointments,
    pendingEvents: [],
    currentProjectedKPIs: EMPTY_KPIS,
  };
}

function makeRuntimeMap(
  runtimes: ReadonlyArray<AppointmentRuntime>,
): AppointmentRuntimeMap {
  const map: Record<EventId, AppointmentRuntime> = {};
  for (const r of runtimes) map[r.eventId] = r;
  return map;
}

function makeContexts(
  runtimes: AppointmentRuntimeMap,
  overrides: {
    professionals?: ReadonlyArray<ProfessionalCapabilities>;
    waitingCandidates?: ReadonlyArray<{
      id: string;
      desiredDuration: number;
      value: number;
      priority: number;
      easeScore: number;
    }>;
    priceByProcedureId?: Record<ResourceId, number>;
  } = {},
): CoordinatorContexts {
  const professionals = overrides.professionals ?? [PROF_A, PROF_B];
  const validation = {
    runtimes,
    professionals,
    rooms: [],
    equipment: EQUIPMENT_NONE,
    proceduresById: { proc_generic: PROC_GENERIC },
    patientHistoryById: {},
  };
  return {
    generation: {
      validation,
      waitlist: {
        candidates: (overrides.waitingCandidates ?? []).map((c) => ({
          id: c.id,
          desiredDuration: c.desiredDuration,
          value: c.value,
          priority: c.priority,
          easeScore: c.easeScore,
          availableNow: true,
          externalRefs: { procedureId: "proc_generic" },
        })),
      },
    },
    validation,
    simulation: {
      runtimes,
      professionals,
      equipment: EQUIPMENT_NONE,
      proceduresById: { proc_generic: PROC_GENERIC },
      priceByProcedureId: overrides.priceByProcedureId ?? {},
    },
  };
}

function cancellationEvent(eventId: EventId): CancellationEvent {
  return {
    kind: "cancellation",
    instant: at(9),
    tenantId: "test_tenant",
    eventId,
    noticeAheadMs: 0,
  };
}

function proactiveTickEvent(): ProactiveTickEvent {
  return {
    kind: "proactive_tick",
    instant: at(9),
    tenantId: "test_tenant",
  };
}

// =============================================================================
// Tests — Mapeo EngineEvent → GenerationTrigger (4)
// =============================================================================

describe("inferTrigger", () => {
  it("cancellation produce gap_detected con Gap derivado del runtime", () => {
    const appointments = [apt("e1")];
    const runtimes = makeRuntimeMap([
      runtime("e1", { start: at(10), plannedDuration: MS_60_MIN }),
    ]);
    const state = makeState(appointments);
    const trigger = inferTrigger(cancellationEvent("e1"), state, runtimes);
    expect(trigger).not.toBeNull();
    expect(trigger?.kind).toBe("gap_detected");
    if (trigger?.kind === "gap_detected") {
      expect(trigger.gap.start).toBe(at(10));
      expect(trigger.gap.duration).toBe(MS_60_MIN);
      expect(trigger.gap.originEventId).toBe("e1");
    }
  });

  it("no_show_detected produce no_show con eventId", () => {
    const event: EngineEvent = {
      kind: "no_show_detected",
      instant: at(9),
      tenantId: "test_tenant",
      eventId: "e1",
    };
    const state = makeState([apt("e1")]);
    const runtimes = makeRuntimeMap([runtime("e1")]);
    const trigger = inferTrigger(event, state, runtimes);
    expect(trigger?.kind).toBe("no_show");
    if (trigger?.kind === "no_show") {
      expect(trigger.eventId).toBe("e1");
    }
  });

  it("professional_absence produce professional_unavailable con rango", () => {
    const event: EngineEvent = {
      kind: "professional_absence",
      instant: at(9),
      tenantId: "test_tenant",
      professionalId: "prof_a",
      absenceRange: { start: at(10), end: at(12) },
    };
    const state = makeState([]);
    const trigger = inferTrigger(event, state, {});
    expect(trigger?.kind).toBe("professional_unavailable");
    if (trigger?.kind === "professional_unavailable") {
      expect(trigger.professionalId).toBe("prof_a");
      expect(trigger.rangeStart).toBe(at(10));
      expect(trigger.rangeEnd).toBe(at(12));
    }
  });

  it("proactive_tick produce proactive_sweep", () => {
    const trigger = inferTrigger(proactiveTickEvent(), makeState([]), {});
    expect(trigger?.kind).toBe("proactive_sweep");
  });
});

// =============================================================================
// Tests — Eventos sin trigger directo (1)
// =============================================================================

describe("eventos sin trigger directo en v1", () => {
  it("walk_in devuelve trigger null y runCycle propone no_op único", () => {
    const event: EngineEvent = {
      kind: "walk_in",
      instant: at(9),
      tenantId: "test_tenant",
      patientId: null,
      requestedProcedureId: "proc_generic",
      urgency: 3,
    };
    const state = makeState([]);
    const runtimes: AppointmentRuntimeMap = {};
    const trigger = inferTrigger(event, state, runtimes);
    expect(trigger).toBeNull();

    const decision = runCycle(event, state, runtimes, makeContexts(runtimes));
    expect(decision.proposal).toBeNull();
    expect(decision.explanation.recommendedAction).toEqual([{ kind: "no_op" }]);
    expect(decision.autonomyLevel).toBe("detailed_suggestion");
  });
});

// =============================================================================
// Tests — Selección de ganadora (4)
// =============================================================================

describe("selección de ganadora", () => {
  it("sin candidatas viables, gana no_op (proposal null)", () => {
    // Cancellation sobre evento existente pero sin candidatos en waitlist.
    const appointments = [apt("e1", { runtimeStatus: "cancelled" })];
    const runtimes = makeRuntimeMap([runtime("e1", { start: at(10) })]);
    const state = makeState(appointments);
    const ctx = makeContexts(runtimes);

    const decision = runCycle(cancellationEvent("e1"), state, runtimes, ctx);
    expect(decision.proposal).toBeNull();
    expect(decision.explanation.recommendedAction).toEqual([{ kind: "no_op" }]);
  });

  it("candidata fill_from_waitlist con valor alto domina sobre no_op", () => {
    // Cancellation con candidato de waitlist viable y precio alto.
    // El precio realista (€1000) supera el umbral de mejora 0.05 sobre no_op
    // dado el normalizador default de projectedBillableValue (3000€).
    // Con price < ~800€ la mejora es marginal y el motor (correctamente)
    // prefiere no actuar.
    const appointments = [apt("e1", { runtimeStatus: "cancelled" })];
    const runtimes = makeRuntimeMap([
      runtime("e1", { start: at(10), plannedDuration: MS_60_MIN }),
    ]);
    const state = makeState(appointments);
    const ctx = makeContexts(runtimes, {
      waitingCandidates: [
        {
          id: "wc1",
          desiredDuration: MS_60_MIN,
          value: 1000,
          priority: 0.9,
          easeScore: 0.8,
        },
      ],
      priceByProcedureId: { proc_generic: 1000 },
    });

    const decision = runCycle(cancellationEvent("e1"), state, runtimes, ctx);
    expect(decision.proposal).not.toBeNull();
    expect(decision.proposal?.[0].kind).toBe("fill_from_waitlist");
  });

  it("umbral alto fuerza no_op aunque haya mejora marginal", () => {
    const appointments = [apt("e1", { runtimeStatus: "cancelled" })];
    const runtimes = makeRuntimeMap([
      runtime("e1", { start: at(10), plannedDuration: MS_60_MIN }),
    ]);
    const state = makeState(appointments);
    const ctx = makeContexts(runtimes, {
      waitingCandidates: [
        {
          id: "wc1",
          desiredDuration: MS_60_MIN,
          value: 50,
          priority: 0.5,
          easeScore: 0.5,
        },
      ],
      priceByProcedureId: { proc_generic: 50 },
    });

    // Umbral irreal de mejora: ningún fill marginal va a superarlo.
    const options: CoordinatorOptions = { improvementThreshold: 100 };
    const decision = runCycle(
      cancellationEvent("e1"),
      state,
      runtimes,
      ctx,
      options,
    );
    expect(decision.proposal).toBeNull();
  });

  it("umbral por defecto: candidata con mejora suficiente gana", () => {
    // Mismo setup que el test "fill_from_waitlist domina" pero verificando
    // explícitamente el efecto del umbral default 0.05 con un price alto.
    const appointments = [apt("e1", { runtimeStatus: "cancelled" })];
    const runtimes = makeRuntimeMap([
      runtime("e1", { start: at(10), plannedDuration: MS_60_MIN }),
    ]);
    const state = makeState(appointments);
    const ctx = makeContexts(runtimes, {
      waitingCandidates: [
        {
          id: "wc1",
          desiredDuration: MS_60_MIN,
          value: 1500,
          priority: 1.0,
          easeScore: 1.0,
        },
      ],
      priceByProcedureId: { proc_generic: 1500 },
    });

    const decision = runCycle(cancellationEvent("e1"), state, runtimes, ctx);
    expect(decision.proposal).not.toBeNull();
  });
});

// =============================================================================
// Tests — Construcción de Explanation (4)
// =============================================================================

describe("construcción de Explanation", () => {
  it("deriveMotiveCode mapea correctamente fill_from_waitlist", () => {
    const action: CompositeAction = [
      {
        kind: "fill_from_waitlist",
        waitingCandidateId: "wc1",
        gapStart: at(10),
        gapResourceId: "room_1",
        proposedDuration: MS_60_MIN,
      },
    ];
    expect(deriveMotiveCode(action)).toBe("FILLS_GAP_WITH_VALUE");
  });

  it("deriveMotiveCode con no_op puro devuelve RECOVERS_BILLABLE_VALUE default", () => {
    const action: CompositeAction = [{ kind: "no_op" }];
    expect(deriveMotiveCode(action)).toBe("RECOVERS_BILLABLE_VALUE");
  });

  it("consideredAlternatives queda ordenado por score DESC (invariante I-14)", () => {
    // Configurar varias candidatas con scores distintos para verificar el orden.
    const appointments = [apt("e1", { runtimeStatus: "cancelled" })];
    const runtimes = makeRuntimeMap([
      runtime("e1", { start: at(10), plannedDuration: MS_60_MIN }),
    ]);
    const state = makeState(appointments);
    const ctx = makeContexts(runtimes, {
      waitingCandidates: [
        {
          id: "wc1",
          desiredDuration: MS_30_MIN,
          value: 300,
          priority: 0.9,
          easeScore: 0.9,
        },
        {
          id: "wc2",
          desiredDuration: MS_30_MIN,
          value: 100,
          priority: 0.5,
          easeScore: 0.5,
        },
        {
          id: "wc3",
          desiredDuration: MS_30_MIN,
          value: 50,
          priority: 0.3,
          easeScore: 0.3,
        },
      ],
      priceByProcedureId: { proc_generic: 300 },
    });

    const decision = runCycle(cancellationEvent("e1"), state, runtimes, ctx);
    const scores = decision.explanation.consideredAlternatives.map((a) => a.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("deriveDiscardReasonCode marca WORSE_THAN_NO_OP cuando candidata pierde", () => {
    const candidate: ScoreResult = {
      totalScore: -0.5,
      breakdown: {
        kpiContributions: EMPTY_KPIS,
        kpiSubtotal: -0.5,
        riskPenalty: 0,
        changeCostPenalty: 0,
        changeCostBreakdown: {
          notifyPatientCount: 0,
          reassignProfessionalCount: 0,
          reassignResourceCount: 0,
          otherPrimitiveCount: 0,
          totalCost: 0,
        },
      },
    };
    const noOp: ScoreResult = {
      totalScore: 0,
      breakdown: {
        kpiContributions: EMPTY_KPIS,
        kpiSubtotal: 0,
        riskPenalty: 0,
        changeCostPenalty: 0,
        changeCostBreakdown: {
          notifyPatientCount: 0,
          reassignProfessionalCount: 0,
          reassignResourceCount: 0,
          otherPrimitiveCount: 0,
          totalCost: 0,
        },
      },
    };
    expect(deriveDiscardReasonCode(candidate, noOp, 0.05)).toBe(
      "WORSE_THAN_NO_OP",
    );
  });
});

// =============================================================================
// Tests — Política de autonomía v1 (1)
// =============================================================================

describe("política de autonomía v1", () => {
  it("siempre devuelve detailed_suggestion y autoExecutedActions vacío", () => {
    const decision = runCycle(
      proactiveTickEvent(),
      makeState([]),
      {},
      makeContexts({}),
    );
    expect(decision.autonomyLevel).toBe("detailed_suggestion");
    expect(decision.autoExecutedActions).toEqual([]);
  });
});

// =============================================================================
// Tests — Integración end-to-end (2)
// =============================================================================

describe("runCycle integración end-to-end", () => {
  it("ciclo completo con cancellation + waitlist viable produce proposal con fill", () => {
    const appointments = [
      apt("e1", { runtimeStatus: "cancelled" }),
      apt("e2", { runtimeStatus: "scheduled" }),
    ];
    const runtimes = makeRuntimeMap([
      runtime("e1", { start: at(10), plannedDuration: MS_60_MIN }),
      runtime("e2", { start: at(11), plannedDuration: MS_30_MIN }),
    ]);
    const state = makeState(appointments);
    const ctx = makeContexts(runtimes, {
      waitingCandidates: [
        {
          id: "wc1",
          desiredDuration: MS_60_MIN,
          value: 1000,
          priority: 0.9,
          easeScore: 0.8,
        },
      ],
      priceByProcedureId: { proc_generic: 1000 },
    });

    const decision = runCycle(cancellationEvent("e1"), state, runtimes, ctx);
    expect(decision.proposal).not.toBeNull();
    expect(decision.proposal?.[0].kind).toBe("fill_from_waitlist");
    expect(decision.explanation.motiveCode).toBe("FILLS_GAP_WITH_VALUE");
    expect(decision.explanation.recommendedAction).toEqual(decision.proposal);
    expect(decision.explanation.projectedKPIs.projectedBillableValue).toBeGreaterThan(0);
  });

  it("ciclo completo con proactive_tick devuelve no_op (v1)", () => {
    // proactive_sweep en v1 no genera candidatas no-triviales (generator.ts §generateForProactiveSweep).
    const appointments = [apt("e1")];
    const runtimes = makeRuntimeMap([runtime("e1")]);
    const state = makeState(appointments);
    const ctx = makeContexts(runtimes);

    const decision = runCycle(proactiveTickEvent(), state, runtimes, ctx);
    expect(decision.proposal).toBeNull();
    expect(decision.explanation.recommendedAction).toEqual([{ kind: "no_op" }]);
  });
});