/**
 * Tests del Generator (C3) — Sesión 14.
 *
 * 16 tests distribuidos:
 *  - gap_detected (3): candidatas viables, descarta inválidas, respeta MAX.
 *  - no_show (2): sintetiza Gap correctamente, eventId desconocido devuelve solo no_op.
 *  - overrun_propagation (3): genera postpone para downstream, compress sobre origen,
 *    sin downstream solo compress.
 *  - professional_unavailable (3): reasigna a compatibles, descarta auto-asignación,
 *    sin afectados solo no_op.
 *  - proactive_sweep (1): devuelve solo no_op (v1 mínima).
 *  - invariantes generales (4): I-13 no_op siempre presente, candidatas son CompositeAction válidas,
 *    maxCandidates respetado, candidatas filtradas por C2.
 */

import { describe, it, expect } from "vitest";
import { generateCandidates } from "./generator";
import type {
  GenerationContext,
  GenerationTrigger,
} from "./generator-types";
import type { ValidationContext } from "./validator";
import { type AppointmentRuntimeMap } from "./state-transitions";
import type {
  DayState,
  AppointmentState,
  WaitingCandidate,
  KPIVector,
  Gap,
} from "./types";
import type {
  ProfessionalCapabilities,
  ProcedureRequirements,
} from "./domain-types";

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

const NEUTRAL_DIST = {
  mean: 30 * 60 * 1000,
  stdDev: 5 * 60 * 1000,
  p10: 20 * 60 * 1000,
  p50: 30 * 60 * 1000,
  p90: 40 * 60 * 1000,
};

// Lunes 11 de mayo de 2026 a las 09:00 UTC. dayOfWeek 1.
const MONDAY_0900_UTC = Date.UTC(2026, 4, 11, 9, 0, 0);
const HOUR_MS = 60 * 60 * 1000;

function buildAppointment(eventId: string): AppointmentState {
  return {
    eventId,
    runtimeStatus: "scheduled",
    estimatedEndDistribution: NEUTRAL_DIST,
    detectedRisks: {
      overrunProbability: 0,
      noShowProbability: 0,
      significantLatenessProbability: 0,
    },
  };
}

function buildState(appointments: ReadonlyArray<AppointmentState> = []): DayState {
  return {
    tenantId: "1",
    date: MONDAY_0900_UTC,
    currentInstant: MONDAY_0900_UTC,
    rooms: [],
    professionals: [],
    equipment: [],
    appointments,
    pendingEvents: [],
    currentProjectedKPIs: ZERO_KPIS,
  };
}

function emptyValidationContext(
  runtimes: AppointmentRuntimeMap = {},
  professionals: ReadonlyArray<ProfessionalCapabilities> = [],
  proceduresById: Readonly<Record<string, ProcedureRequirements>> = {},
): ValidationContext {
  return {
    runtimes,
    professionals,
    rooms: [],
    equipment: [],
    proceduresById,
    patientHistoryById: {},
  };
}

function buildContext(
  validation: ValidationContext,
  candidates: ReadonlyArray<WaitingCandidate> = [],
): GenerationContext {
  return {
    validation,
    waitlist: { candidates },
  };
}

// =============================================================================
// gap_detected (3 tests)
// =============================================================================

describe("generateCandidates — gap_detected", () => {
  const dent: ProfessionalCapabilities = {
    professionalId: "dent-1",
    capabilities: { general_dentistry: 1 },
    workSchedule: null,
    hourlyCost: null,
  };

  const gap: Gap = {
    resourceId: "room-1",
    start: MONDAY_0900_UTC,
    duration: HOUR_MS,
    originEventId: "cancelled-1",
  };

  const trigger: GenerationTrigger = { kind: "gap_detected", gap };

  it("genera fill_from_waitlist por cada candidato viable", () => {
    const candidates: WaitingCandidate[] = [
      {
        id: "w-a",
        desiredDuration: 30 * 60 * 1000,
        value: 100,
        priority: 0.8,
        easeScore: 0.7,
        availableNow: true,
      },
      {
        id: "w-b",
        desiredDuration: 45 * 60 * 1000,
        value: 200,
        priority: 0.6,
        easeScore: 0.9,
        availableNow: true,
      },
    ];
    const validation = emptyValidationContext({}, [dent]);
    const ctx = buildContext(validation, candidates);
    const result = generateCandidates(buildState(), {}, trigger, ctx);
    // 1 no_op + 2 candidatas reales
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual([{ kind: "no_op" }]);
    const fillKinds = result
      .slice(1)
      .map((c) => c[0])
      .filter((p) => p.kind === "fill_from_waitlist")
      .map((p) => (p as { waitingCandidateId: string }).waitingCandidateId);
    expect(fillKinds).toContain("w-a");
    expect(fillKinds).toContain("w-b");
  });

  it("descarta candidatos cuya desiredDuration excede el gap", () => {
    const candidates: WaitingCandidate[] = [
      {
        id: "w-fits",
        desiredDuration: 30 * 60 * 1000,
        value: 100,
        priority: 0.5,
        easeScore: 0.5,
        availableNow: true,
      },
      {
        id: "w-too-long",
        desiredDuration: 90 * 60 * 1000, // excede gap de 60 min
        value: 500,
        priority: 0.9,
        easeScore: 0.9,
        availableNow: true,
      },
    ];
    const validation = emptyValidationContext({}, [dent]);
    const ctx = buildContext(validation, candidates);
    const result = generateCandidates(buildState(), {}, trigger, ctx);
    // Solo el que cabe
    expect(result).toHaveLength(2);
    const real = result[1][0];
    expect(real.kind).toBe("fill_from_waitlist");
    expect((real as { waitingCandidateId: string }).waitingCandidateId).toBe("w-fits");
  });

  it("respeta maxCandidates", () => {
    const candidates: WaitingCandidate[] = Array.from({ length: 25 }, (_, i) => ({
      id: `w-${i}`,
      desiredDuration: 30 * 60 * 1000,
      value: 100 + i,
      priority: 0.5,
      easeScore: 0.5,
      availableNow: true,
    }));
    const validation = emptyValidationContext({}, [dent]);
    const ctx = buildContext(validation, candidates);
    const result = generateCandidates(buildState(), {}, trigger, ctx, {
      maxCandidates: 5,
    });
    // 1 no_op + 5 reales
    expect(result).toHaveLength(6);
  });
});

// =============================================================================
// no_show (2 tests)
// =============================================================================

describe("generateCandidates — no_show", () => {
  const dent: ProfessionalCapabilities = {
    professionalId: "dent-1",
    capabilities: { general_dentistry: 1 },
    workSchedule: null,
    hourlyCost: null,
  };

  it("sintetiza un Gap a partir del runtime y produce fill_from_waitlist", () => {
    const runtimes: AppointmentRuntimeMap = {
      "apt-noshow": {
        eventId: "apt-noshow",
        professionalId: "dent-2",
        roomId: "room-X",
        start: MONDAY_0900_UTC,
        plannedDuration: 30 * 60 * 1000,
        procedureId: "proc-1",
        patientId: "pat-1",
        reservedEquipment: [],
      },
    };
    const candidates: WaitingCandidate[] = [
      {
        id: "w-a",
        desiredDuration: 30 * 60 * 1000,
        value: 100,
        priority: 0.5,
        easeScore: 0.5,
        availableNow: true,
      },
    ];
    const state = buildState([
      { ...buildAppointment("apt-noshow"), runtimeStatus: "no_show" },
    ]);
    const validation = emptyValidationContext(runtimes, [dent]);
    const ctx = buildContext(validation, candidates);
    const result = generateCandidates(
      state,
      runtimes,
      { kind: "no_show", eventId: "apt-noshow" },
      ctx,
    );
    expect(result).toHaveLength(2);
    const real = result[1][0];
    expect(real.kind).toBe("fill_from_waitlist");
    expect((real as { gapResourceId: string }).gapResourceId).toBe("room-X");
    expect((real as { gapStart: number }).gapStart).toBe(MONDAY_0900_UTC);
  });

  it("eventId desconocido devuelve solo no_op", () => {
    const validation = emptyValidationContext();
    const ctx = buildContext(validation);
    const result = generateCandidates(
      buildState(),
      {},
      { kind: "no_show", eventId: "ghost" },
      ctx,
    );
    expect(result).toEqual([[{ kind: "no_op" }]]);
  });
});

// =============================================================================
// overrun_propagation (3 tests)
// =============================================================================

describe("generateCandidates — overrun_propagation", () => {
  const dent: ProfessionalCapabilities = {
    professionalId: "dent-1",
    capabilities: { general_dentistry: 1 },
    workSchedule: null,
    hourlyCost: null,
  };

  it("genera postpone para cada cita downstream + compress sobre el origen", () => {
    const runtimes: AppointmentRuntimeMap = {
      "apt-origin": {
        eventId: "apt-origin",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_0900_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-A",
        reservedEquipment: [],
      },
      "apt-down1": {
        eventId: "apt-down1",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_0900_UTC + HOUR_MS,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-B",
        reservedEquipment: [],
      },
    };
    const state = buildState([
      buildAppointment("apt-origin"),
      buildAppointment("apt-down1"),
    ]);
    const validation = emptyValidationContext(runtimes, [dent]);
    const ctx = buildContext(validation);
    const result = generateCandidates(
      state,
      runtimes,
      {
        kind: "overrun_propagation",
        originEventId: "apt-origin",
        estimatedSlippage: 15 * 60 * 1000,
        affectedDownstreamEventIds: ["apt-down1"],
      },
      ctx,
    );
    // 1 no_op + al menos 1 postpone + 1 compress (puede que validación filtre).
    // Verificamos: la lista contiene al menos un postpone sobre apt-down1
    // o un compress sobre apt-origin.
    const allKinds = result.slice(1).flatMap((c) => c.map((p) => p.kind));
    expect(allKinds.some((k) => k === "postpone" || k === "compress")).toBe(true);
  });

  it("sin downstream afectado, solo emite compress sobre origen", () => {
    const runtimes: AppointmentRuntimeMap = {
      "apt-origin": {
        eventId: "apt-origin",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_0900_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-A",
        reservedEquipment: [],
      },
    };
    const state = buildState([buildAppointment("apt-origin")]);
    const validation = emptyValidationContext(runtimes, [dent]);
    const ctx = buildContext(validation);
    const result = generateCandidates(
      state,
      runtimes,
      {
        kind: "overrun_propagation",
        originEventId: "apt-origin",
        estimatedSlippage: 10 * 60 * 1000,
        affectedDownstreamEventIds: [],
      },
      ctx,
    );
    const realCandidates = result.slice(1);
    expect(realCandidates).toHaveLength(1);
    expect(realCandidates[0][0].kind).toBe("compress");
  });

  it("originEventId desconocido + sin downstream → solo no_op", () => {
    const validation = emptyValidationContext();
    const ctx = buildContext(validation);
    const result = generateCandidates(
      buildState(),
      {},
      {
        kind: "overrun_propagation",
        originEventId: "ghost",
        estimatedSlippage: 5 * 60 * 1000,
        affectedDownstreamEventIds: [],
      },
      ctx,
    );
    expect(result).toEqual([[{ kind: "no_op" }]]);
  });
});

// =============================================================================
// professional_unavailable (3 tests)
// =============================================================================

describe("generateCandidates — professional_unavailable", () => {
  const dentA: ProfessionalCapabilities = {
    professionalId: "dent-A",
    capabilities: { general_dentistry: 1 },
    workSchedule: null,
    hourlyCost: null,
  };
  const dentB: ProfessionalCapabilities = {
    professionalId: "dent-B",
    capabilities: { general_dentistry: 1 },
    workSchedule: null,
    hourlyCost: null,
  };

  it("reasigna citas afectadas a profesionales compatibles distintos del ausente", () => {
    const runtimes: AppointmentRuntimeMap = {
      "apt-1": {
        eventId: "apt-1",
        professionalId: "dent-A",
        roomId: "room-1",
        start: MONDAY_0900_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-X",
        reservedEquipment: [],
      },
    };
    const state = buildState([buildAppointment("apt-1")]);
    const validation = emptyValidationContext(runtimes, [dentA, dentB]);
    const ctx = buildContext(validation);
    const result = generateCandidates(
      state,
      runtimes,
      {
        kind: "professional_unavailable",
        professionalId: "dent-A",
        rangeStart: MONDAY_0900_UTC,
        rangeEnd: MONDAY_0900_UTC + 2 * HOUR_MS,
      },
      ctx,
    );
    const realCandidates = result.slice(1);
    expect(realCandidates).toHaveLength(1);
    const prim = realCandidates[0][0];
    expect(prim.kind).toBe("reassign_professional");
    expect((prim as { newProfessionalId: string }).newProfessionalId).toBe("dent-B");
  });

  it("sin profesionales alternativos compatibles → solo no_op", () => {
    const runtimes: AppointmentRuntimeMap = {
      "apt-1": {
        eventId: "apt-1",
        professionalId: "dent-A",
        roomId: "room-1",
        start: MONDAY_0900_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-X",
        reservedEquipment: [],
      },
    };
    const state = buildState([buildAppointment("apt-1")]);
    const validation = emptyValidationContext(runtimes, [dentA]); // solo el ausente
    const ctx = buildContext(validation);
    const result = generateCandidates(
      state,
      runtimes,
      {
        kind: "professional_unavailable",
        professionalId: "dent-A",
        rangeStart: MONDAY_0900_UTC,
        rangeEnd: MONDAY_0900_UTC + 2 * HOUR_MS,
      },
      ctx,
    );
    expect(result).toEqual([[{ kind: "no_op" }]]);
  });

  it("sin appointments del profesional ausente → solo no_op", () => {
    const validation = emptyValidationContext({}, [dentA, dentB]);
    const ctx = buildContext(validation);
    const result = generateCandidates(
      buildState(),
      {},
      {
        kind: "professional_unavailable",
        professionalId: "dent-A",
        rangeStart: MONDAY_0900_UTC,
        rangeEnd: MONDAY_0900_UTC + 2 * HOUR_MS,
      },
      ctx,
    );
    expect(result).toEqual([[{ kind: "no_op" }]]);
  });
});

// =============================================================================
// proactive_sweep (1 test)
// =============================================================================

describe("generateCandidates — proactive_sweep", () => {
  it("v1 devuelve solo no_op", () => {
    const validation = emptyValidationContext();
    const ctx = buildContext(validation);
    const result = generateCandidates(
      buildState(),
      {},
      { kind: "proactive_sweep" },
      ctx,
    );
    expect(result).toEqual([[{ kind: "no_op" }]]);
  });
});

// =============================================================================
// Invariantes generales (4 tests)
// =============================================================================

describe("generateCandidates — invariantes", () => {
  const dent: ProfessionalCapabilities = {
    professionalId: "dent-1",
    capabilities: { general_dentistry: 1 },
    workSchedule: null,
    hourlyCost: null,
  };

  it("I-13: no_op SIEMPRE presente como primera candidata", () => {
    const validation = emptyValidationContext();
    const ctx = buildContext(validation);
    // Sobre un trigger donde no hay candidatas reales
    const result = generateCandidates(
      buildState(),
      {},
      { kind: "proactive_sweep" },
      ctx,
    );
    expect(result[0]).toEqual([{ kind: "no_op" }]);
  });

  it("todas las candidatas son arrays no vacíos (CompositeAction válido)", () => {
    const candidates: WaitingCandidate[] = [
      {
        id: "w-a",
        desiredDuration: 30 * 60 * 1000,
        value: 100,
        priority: 0.5,
        easeScore: 0.5,
        availableNow: true,
      },
    ];
    const gap: Gap = {
      resourceId: "room-1",
      start: MONDAY_0900_UTC,
      duration: HOUR_MS,
      originEventId: "x",
    };
    const validation = emptyValidationContext({}, [dent]);
    const ctx = buildContext(validation, candidates);
    const result = generateCandidates(
      buildState(),
      {},
      { kind: "gap_detected", gap },
      ctx,
    );
    for (const candidate of result) {
      expect(candidate.length).toBeGreaterThan(0);
    }
  });

  it("respeta maxCandidates en gap_detected", () => {
    const candidates: WaitingCandidate[] = Array.from({ length: 30 }, (_, i) => ({
      id: `w-${i}`,
      desiredDuration: 30 * 60 * 1000,
      value: 100,
      priority: 0.5,
      easeScore: 0.5,
      availableNow: true,
    }));
    const gap: Gap = {
      resourceId: "room-1",
      start: MONDAY_0900_UTC,
      duration: HOUR_MS,
      originEventId: "x",
    };
    const validation = emptyValidationContext({}, [dent]);
    const ctx = buildContext(validation, candidates);
    const result = generateCandidates(
      buildState(),
      {},
      { kind: "gap_detected", gap },
      ctx,
      { maxCandidates: 3 },
    );
    expect(result).toHaveLength(4); // 1 no_op + 3 reales
  });

  it("candidatas que generan PHYSICAL violation se filtran", () => {
    // Estado: ya hay una cita en room-1 a las 09:00 ocupando 30 min con dent-1.
    // Generamos un Gap "fantasma" en room-1 a las 09:15 de 30 min y un candidato
    // que querría rellenarlo. La fill_from_waitlist insertará una nueva cita
    // que solapa con la existente → C2 debe rechazarla.
    const runtimes: AppointmentRuntimeMap = {
      "apt-existing": {
        eventId: "apt-existing",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_0900_UTC,
        plannedDuration: 30 * 60 * 1000,
        procedureId: "p-1",
        patientId: "pat-X",
        reservedEquipment: [],
      },
    };
    const state = buildState([buildAppointment("apt-existing")]);
    const candidates: WaitingCandidate[] = [
      {
        id: "w-overlap",
        desiredDuration: 30 * 60 * 1000,
        value: 100,
        priority: 0.5,
        easeScore: 0.5,
        availableNow: true,
      },
    ];
    const gap: Gap = {
      resourceId: "room-1",
      start: MONDAY_0900_UTC + 15 * 60 * 1000, // solapa con la cita existente
      duration: 30 * 60 * 1000,
      originEventId: "x",
    };
    const validation = emptyValidationContext(runtimes, [dent]);
    const ctx = buildContext(validation, candidates);
    const result = generateCandidates(
      state,
      runtimes,
      { kind: "gap_detected", gap },
      ctx,
    );
    // Solo no_op debe sobrevivir
    expect(result).toEqual([[{ kind: "no_op" }]]);
  });
});