/**
 * Tests del Simulator (C4) — Sesión 15.
 *
 * Cobertura: 18 tests distribuidos según prompt de Sesión 15:
 *   - computeEffectiveUtilization: 3
 *   - computeExpectedOvertime: 3
 *   - computeMeanWaitTime: 2
 *   - computeExpectedForcedCancellations: 2
 *   - computeProjectedBillableValue: 2
 *   - computeRisk: 2
 *   - Helpers de varianza analítica: 2
 *   - simulate (integración): 2
 *
 * Convenciones de fixtures:
 *   - Día base: lunes 11/05/2026 a medianoche UTC (verificado: ese día es lunes,
 *     dayOfWeek=1).
 *   - Profesional con workSchedule 09:00-13:00 + 15:00-19:00 los lunes.
 *   - Citas dentro o fuera de jornada según el test lo requiera.
 */

import { describe, expect, it } from "vitest";
import type {
  AppointmentState,
  CompositeAction,
  DayState,
  DurationDistribution,
  KPIVector,
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
import {
  computeEffectiveUtilization,
  computeExpectedForcedCancellations,
  computeExpectedOvertime,
  computeMeanWaitTime,
  computeProjectedBillableValue,
  computeRisk,
  simulate,
  stdDevFromDistribution,
  varianceFromDistribution,
} from "./simulator";
import type { SimulationContext } from "./simulator-types";

// =============================================================================
// Fixtures base
// =============================================================================

/** Lunes 11/05/2026 medianoche UTC. */
const DAY_BASE: InstantUTC = Date.UTC(2026, 4, 11);

/** Helper: instante de DAY_BASE + HH:MM. */
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

const SCHEDULE_MON_MORNING_ONLY: WorkSchedule = {
  "1": {
    morningOpen: "09:00",
    morningClose: "13:00",
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
  workSchedule: SCHEDULE_MON_MORNING_ONLY,
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

/** Construye una distribución desde p10/p50/p90 dejando que el simulator
 *  derive stdDev de los percentiles (stdDev=0 fuerza el fallback). */
function dist(p10: number, p50: number, p90: number): DurationDistribution {
  return { mean: p50, stdDev: 0, p10, p50, p90 };
}

/** Distribución degenerada (sin incertidumbre). */
function distDeterministic(d: number): DurationDistribution {
  return { mean: d, stdDev: 0, p10: d, p50: d, p90: d };
}

/** Construye un AppointmentState mínimo. */
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

/** Construye un AppointmentRuntime mínimo. */
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
    currentInstant: DAY_BASE + 9 * 60 * 60_000,
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

// =============================================================================
// Tests — computeEffectiveUtilization (3)
// =============================================================================

describe("computeEffectiveUtilization", () => {
  it("devuelve 0 cuando no hay profesionales con schedule documentado", () => {
    const state = makeState([]);
    const result = computeEffectiveUtilization(state, {}, []);
    expect(result).toBe(0);
  });

  it("devuelve fracción correcta con ocupación parcial", () => {
    // PROF_A tiene jornada 09-13 + 15-19 = 8h = 480 min disponibles.
    // Una cita de 60 min → 60/480 = 0.125.
    const appointments = [apt("e1")];
    const runtimes = makeRuntimeMap([
      runtime("e1", { plannedDuration: MS_60_MIN }),
    ]);
    const state = makeState(appointments);
    const result = computeEffectiveUtilization(state, runtimes, [PROF_A]);
    expect(result).toBeCloseTo(0.125, 5);
  });

  it("clampa a 1.0 cuando la duración planeada excede la jornada", () => {
    // Citas que ocupan 10h cuando la jornada es 8h → clampea a 1.0.
    const appointments = [apt("e1"), apt("e2")];
    const runtimes = makeRuntimeMap([
      runtime("e1", { plannedDuration: 6 * MS_60_MIN }),
      runtime("e2", {
        plannedDuration: 4 * MS_60_MIN,
        start: at(15),
      }),
    ]);
    const state = makeState(appointments);
    const result = computeEffectiveUtilization(state, runtimes, [PROF_A]);
    expect(result).toBe(1);
  });
});

// =============================================================================
// Tests — computeExpectedOvertime (3)
// =============================================================================

describe("computeExpectedOvertime", () => {
  it("devuelve 0 cuando no hay overtime", () => {
    // Cita 09:00-10:00, jornada termina 19:00 → 0 overtime.
    const appointments = [apt("e1")];
    const runtimes = makeRuntimeMap([
      runtime("e1", { plannedDuration: MS_60_MIN }),
    ]);
    const state = makeState(appointments);
    const result = computeExpectedOvertime(state, runtimes, [PROF_A]);
    expect(result).toBe(0);
  });

  it("computa overtime de un único profesional", () => {
    // Cita 18:00-20:00, jornada termina 19:00 → 1h overtime.
    const appointments = [apt("e1")];
    const runtimes = makeRuntimeMap([
      runtime("e1", { start: at(18), plannedDuration: 2 * MS_60_MIN }),
    ]);
    const state = makeState(appointments);
    const result = computeExpectedOvertime(state, runtimes, [PROF_A]);
    expect(result).toBe(MS_60_MIN);
  });

  it("suma overtime sobre múltiples profesionales", () => {
    // PROF_A: 18:00-20:00 → 1h overtime (jornada 19:00).
    // PROF_B: 12:00-14:00 → 1h overtime (jornada solo mañana, termina 13:00).
    const appointments = [apt("e1"), apt("e2")];
    const runtimes = makeRuntimeMap([
      runtime("e1", {
        professionalId: "prof_a",
        start: at(18),
        plannedDuration: 2 * MS_60_MIN,
      }),
      runtime("e2", {
        professionalId: "prof_b",
        start: at(12),
        plannedDuration: 2 * MS_60_MIN,
      }),
    ]);
    const state = makeState(appointments);
    const result = computeExpectedOvertime(state, runtimes, [PROF_A, PROF_B]);
    expect(result).toBe(2 * MS_60_MIN);
  });
});

// =============================================================================
// Tests — computeMeanWaitTime (2)
// =============================================================================

describe("computeMeanWaitTime", () => {
  it("devuelve 0 cuando no hay pares profesional con citas consecutivas", () => {
    // Una sola cita → no hay predecesora.
    const appointments = [apt("e1")];
    const runtimes = makeRuntimeMap([runtime("e1")]);
    const state = makeState(appointments);
    const result = computeMeanWaitTime(state, runtimes);
    expect(result).toBe(0);
  });

  it("computa wait cascade cuando p50 de cita N-1 desborda en cita N", () => {
    // Cita e1: 09:00, p50 = 45min (termina esperado a 09:45).
    // Cita e2 del mismo prof: 09:30 → wait = 09:45 - 09:30 = 15min.
    // Cita e3 del mismo prof: 11:00, p50 = 30min, e2 esperado fin 10:00 → wait 0.
    // Pares (e1→e2, e2→e3) → media = (15 + 0) / 2 = 7.5min.
    const appointments = [
      apt("e1", { estimatedEndDistribution: dist(MS_30_MIN, 45 * 60_000, MS_60_MIN) }),
      apt("e2", { estimatedEndDistribution: distDeterministic(MS_30_MIN) }),
      apt("e3"),
    ];
    const runtimes = makeRuntimeMap([
      runtime("e1", { start: at(9, 0), plannedDuration: MS_30_MIN }),
      runtime("e2", { start: at(9, 30), plannedDuration: 90 * 60_000 }),
      runtime("e3", { start: at(11, 0), plannedDuration: MS_30_MIN }),
    ]);
    const state = makeState(appointments);
    const result = computeMeanWaitTime(state, runtimes);
    expect(result).toBeCloseTo(7.5 * 60_000, 0);
  });
});

// =============================================================================
// Tests — computeExpectedForcedCancellations (2)
// =============================================================================

describe("computeExpectedForcedCancellations", () => {
  it("devuelve 0 cuando no hay riesgos", () => {
    const appointments = [apt("e1"), apt("e2")];
    const runtimes = makeRuntimeMap([
      runtime("e1"),
      runtime("e2", { start: at(11) }),
    ]);
    const state = makeState(appointments);
    const result = computeExpectedForcedCancellations(state, runtimes);
    expect(result).toBe(0);
  });

  it("suma probabilidades de no-show + cascade de overrun severo", () => {
    // e1: noShow=0.2, overrun=0.6 → cuenta noShow=0.2 + cascade 0.6*0.5 = 0.5.
    //     (overrun severo > 0.5 con downstream del mismo prof → cascade aplicable).
    // e2: noShow=0.1, downstream de e1 → cuenta solo 0.1 (sin cascade propio).
    // Total = 0.5 + 0.1 = 0.6.
    const appointments = [
      apt("e1", { overrunProbability: 0.6, noShowProbability: 0.2 }),
      apt("e2", { noShowProbability: 0.1 }),
    ];
    const runtimes = makeRuntimeMap([
      runtime("e1", { start: at(9) }),
      runtime("e2", { start: at(11) }),
    ]);
    const state = makeState(appointments);
    const result = computeExpectedForcedCancellations(state, runtimes);
    expect(result).toBeCloseTo(0.6, 5);
  });
});

// =============================================================================
// Tests — computeProjectedBillableValue (2)
// =============================================================================

describe("computeProjectedBillableValue", () => {
  it("devuelve 0 cuando no hay appointments", () => {
    const state = makeState([]);
    const result = computeProjectedBillableValue(state, {}, {});
    expect(result).toBe(0);
  });

  it("suma price × (1 - noShowProbability) sobre citas con precio", () => {
    // e1: price=100, noShow=0.2 → 80.
    // e2: price=200, noShow=0   → 200.
    // e3: procedureId sin precio → 0.
    const appointments = [
      apt("e1", { noShowProbability: 0.2 }),
      apt("e2"),
      apt("e3"),
    ];
    const runtimes = makeRuntimeMap([
      runtime("e1", { procedureId: "proc_p1" }),
      runtime("e2", { procedureId: "proc_p2", start: at(10) }),
      runtime("e3", { procedureId: "proc_unknown", start: at(11) }),
    ]);
    const state = makeState(appointments);
    const prices = { proc_p1: 100, proc_p2: 200 };
    const result = computeProjectedBillableValue(state, runtimes, prices);
    expect(result).toBeCloseTo(280, 5);
  });
});

// =============================================================================
// Tests — computeRisk (2)
// =============================================================================

describe("computeRisk", () => {
  it("devuelve 0 con vector de varianzas en cero", () => {
    const result = computeRisk({
      effectiveUtilization: 0,
      expectedOvertime: 0,
      meanWaitTime: 0,
      expectedForcedCancellations: 0,
      projectedBillableValue: 0,
    });
    expect(result).toBe(0);
  });

  it("devuelve valor positivo con varianzas no nulas", () => {
    const result = computeRisk({
      effectiveUtilization: 0.01,
      expectedOvertime: 1e10,
      meanWaitTime: 5e9,
      expectedForcedCancellations: 1.5,
      projectedBillableValue: 5000,
    });
    expect(result).toBeGreaterThan(0);
    expect(Number.isFinite(result)).toBe(true);
  });
});

// =============================================================================
// Tests — Helpers de varianza analítica (2)
// =============================================================================

describe("varianza analítica desde DurationDistribution", () => {
  it("stdDevFromDistribution respeta stdDev pre-calculado si > 0", () => {
    const d: DurationDistribution = {
      mean: 30 * 60_000,
      stdDev: 5 * 60_000,
      p10: 20 * 60_000,
      p50: 30 * 60_000,
      p90: 40 * 60_000,
    };
    const s = stdDevFromDistribution(d);
    expect(s).toBe(5 * 60_000);
  });

  it("stdDevFromDistribution deriva de p90-p10 cuando stdDev es 0", () => {
    // p90 - p10 = 20 min → stdDev ≈ 20/2.5631 ≈ 7.804 min.
    const d = dist(20 * 60_000, 30 * 60_000, 40 * 60_000);
    const s = stdDevFromDistribution(d);
    const expected = (20 * 60_000) / 2.5631;
    expect(s).toBeCloseTo(expected, 0);

    const v = varianceFromDistribution(d);
    expect(v).toBeCloseTo(expected * expected, 0);
  });
});

// =============================================================================
// Tests — simulate (integración) (2)
// =============================================================================

describe("simulate (integración)", () => {
  function buildContext(
    runtimes: AppointmentRuntimeMap,
    overrides: Partial<SimulationContext> = {},
  ): SimulationContext {
    return {
      runtimes,
      professionals: [PROF_A],
      equipment: EQUIPMENT_NONE,
      proceduresById: { proc_generic: PROC_GENERIC },
      priceByProcedureId: {},
      ...overrides,
    };
  }

  it("no_op sobre state vacío devuelve KPIs en cero y sin eventos", () => {
    const state = makeState([]);
    const ctx = buildContext({});
    const action: CompositeAction = [{ kind: "no_op" }];
    const result = simulate(state, action, ctx);

    expect(result.expectedKPIs.effectiveUtilization).toBe(0);
    expect(result.expectedKPIs.expectedOvertime).toBe(0);
    expect(result.expectedKPIs.meanWaitTime).toBe(0);
    expect(result.expectedKPIs.expectedForcedCancellations).toBe(0);
    expect(result.expectedKPIs.projectedBillableValue).toBe(0);
    expect(result.expectedKPIs.risk).toBe(0);
    expect(result.varianceKPIs.risk).toBe(0);
    expect(result.projectedEvents).toEqual([]);
    expect(result.criticalPoints).toEqual([]);
  });

  it("no_op sobre state real proyecta KPIs coherentes y emite eventos sobre umbral", () => {
    // 2 citas: e1 con overrun=0.5 (sobre umbral 0.3) y noShow=0.4 (sobre 0.3),
    //          e2 sin riesgos. Esperamos:
    //   - effectiveUtilization > 0
    //   - expectedForcedCancellations = 0.4 + cascade de e1 (overrun 0.5 NO > 0.5,
    //     no contribuye cascade). Total = 0.4.
    //   - 2 ProjectedEvent emitidos para e1 (overrun + no_show), 0 para e2.
    //   - projectedBillableValue = 100*(1-0.4) + 100*(1-0) = 60 + 100 = 160.
    //   - risk > 0 porque hay varianza por noShow Bernoulli + overrun en aggregate.
    const appointments = [
      apt("e1", {
        estimatedEndDistribution: dist(20 * 60_000, 30 * 60_000, 50 * 60_000),
        overrunProbability: 0.5,
        noShowProbability: 0.4,
      }),
      apt("e2"),
    ];
    const runtimes = makeRuntimeMap([
      runtime("e1", { start: at(9) }),
      runtime("e2", { start: at(11), procedureId: "proc_generic" }),
    ]);
    const state = makeState(appointments);
    const ctx = buildContext(runtimes, {
      priceByProcedureId: { proc_generic: 100 },
    });
    const action: CompositeAction = [{ kind: "no_op" }];
    const result = simulate(state, action, ctx);

    expect(result.expectedKPIs.effectiveUtilization).toBeGreaterThan(0);
    expect(result.expectedKPIs.expectedForcedCancellations).toBeCloseTo(0.4, 5);
    expect(result.expectedKPIs.projectedBillableValue).toBeCloseTo(160, 5);
    expect(result.expectedKPIs.risk).toBeGreaterThan(0);
    expect(result.varianceKPIs.risk).toBe(result.expectedKPIs.risk);

    const eventsForE1 = result.projectedEvents.filter(
      (e) => e.affectedEventId === "e1",
    );
    expect(eventsForE1.length).toBe(2);
    expect(eventsForE1.map((e) => e.kind).sort()).toEqual([
      "potential_no_show",
      "potential_overrun",
    ]);

    const eventsForE2 = result.projectedEvents.filter(
      (e) => e.affectedEventId === "e2",
    );
    expect(eventsForE2.length).toBe(0);
  });
});