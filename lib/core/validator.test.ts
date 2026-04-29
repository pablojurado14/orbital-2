/**
 * Tests del Validator (C2) — Sesión 13.
 *
 * 21 tests:
 *  - PHYSICAL (4): solape de room, solape de profesional, no solape OK,
 *    citas canceladas no cuentan.
 *  - PROFESSIONAL_HOURS (4): dentro de mañana OK, dentro de tarde OK,
 *    fuera de horas violación, sin workSchedule no se valida.
 *  - RESOURCE_AVAILABILITY (3): conflicto de equipo, no conflicto, mismo
 *    appointment con mismo equipo no genera self-conflict.
 *  - CHAINING (4): precondición satisfecha OK, no satisfecha violación,
 *    sin precondición no aplica, completedAt posterior al start no satisface.
 *  - listCompatible (5): professional con cap completa, professional sin cap,
 *    room con cap, equipment match por tipo, kind sin requisitos devuelve [].
 *  - validate integración (1): no_op sobre state válido devuelve valid:true.
 */

import { describe, it, expect } from "vitest";
import { validate, listCompatible, type ValidationContext } from "./validator";
import { type AppointmentRuntimeMap } from "./state-transitions";
import type {
  DayState,
  AppointmentState,
  CompositeAction,
  KPIVector,
} from "./types";
import type {
  ProcedureRequirements,
  ProfessionalCapabilities,
  RoomCapabilities,
  EquipmentInfo,
  PatientHistory,
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

function buildAppointment(
  eventId: string,
  status: AppointmentState["runtimeStatus"] = "scheduled",
): AppointmentState {
  return {
    eventId,
    runtimeStatus: status,
    estimatedEndDistribution: NEUTRAL_DIST,
    detectedRisks: {
      overrunProbability: 0,
      noShowProbability: 0,
      significantLatenessProbability: 0,
    },
  };
}

// Lunes 11 de mayo de 2026 a las 09:00 UTC. Date.UTC(2026, 4, 11).getUTCDay() === 1.
const MONDAY_0900_UTC = Date.UTC(2026, 4, 11, 9, 0, 0);
const MONDAY_1000_UTC = Date.UTC(2026, 4, 11, 10, 0, 0);
const MONDAY_1500_UTC = Date.UTC(2026, 4, 11, 15, 0, 0);
const MONDAY_2200_UTC = Date.UTC(2026, 4, 11, 22, 0, 0);
const HOUR_MS = 60 * 60 * 1000;

function emptyContext(): ValidationContext {
  return {
    runtimes: {},
    professionals: [],
    rooms: [],
    equipment: [],
    proceduresById: {},
    patientHistoryById: {},
  };
}

function buildState(appointments: ReadonlyArray<AppointmentState>): DayState {
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

const NOOP: CompositeAction = [{ kind: "no_op" }];

// =============================================================================
// PHYSICAL (4 tests)
// =============================================================================

describe("validate — PHYSICAL", () => {
  it("dos appointments solapados en el mismo room generan hard violation", () => {
    const state = buildState([buildAppointment("a"), buildAppointment("b")]);
    const runtimes: AppointmentRuntimeMap = {
      a: {
        eventId: "a",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_0900_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-1",
        reservedEquipment: [],
      },
      b: {
        eventId: "b",
        professionalId: "dent-2",
        roomId: "room-1",
        start: MONDAY_0900_UTC + 30 * 60 * 1000,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-2",
        reservedEquipment: [],
      },
    };
    const ctx: ValidationContext = { ...emptyContext(), runtimes };
    const result = validate(state, NOOP, ctx);
    expect(result.valid).toBe(false);
    expect(result.hardViolations).toHaveLength(1);
    expect(result.hardViolations[0].code).toBe("PHYSICAL");
    expect(result.hardViolations[0].affectedResourceIds).toContain("room-1");
  });

  it("dos appointments solapados con el mismo profesional generan hard violation", () => {
    const state = buildState([buildAppointment("a"), buildAppointment("b")]);
    const runtimes: AppointmentRuntimeMap = {
      a: {
        eventId: "a",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_0900_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-1",
        reservedEquipment: [],
      },
      b: {
        eventId: "b",
        professionalId: "dent-1",
        roomId: "room-2",
        start: MONDAY_0900_UTC + 30 * 60 * 1000,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-2",
        reservedEquipment: [],
      },
    };
    const ctx: ValidationContext = { ...emptyContext(), runtimes };
    const result = validate(state, NOOP, ctx);
    expect(result.valid).toBe(false);
    expect(result.hardViolations[0].affectedResourceIds).toContain("dent-1");
  });

  it("dos appointments NO solapados en mismo recurso son válidos", () => {
    const state = buildState([buildAppointment("a"), buildAppointment("b")]);
    const runtimes: AppointmentRuntimeMap = {
      a: {
        eventId: "a",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_0900_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-1",
        reservedEquipment: [],
      },
      b: {
        eventId: "b",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_0900_UTC + 2 * HOUR_MS,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-2",
        reservedEquipment: [],
      },
    };
    const ctx: ValidationContext = { ...emptyContext(), runtimes };
    const result = validate(state, NOOP, ctx);
    expect(result.valid).toBe(true);
  });

  it("appointment cancelado no participa en chequeos PHYSICAL", () => {
    const state = buildState([
      buildAppointment("a"),
      buildAppointment("b", "cancelled"),
    ]);
    const runtimes: AppointmentRuntimeMap = {
      a: {
        eventId: "a",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_0900_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-1",
        reservedEquipment: [],
      },
      b: {
        eventId: "b",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_0900_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-2",
        reservedEquipment: [],
      },
    };
    const ctx: ValidationContext = { ...emptyContext(), runtimes };
    const result = validate(state, NOOP, ctx);
    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// PROFESSIONAL_HOURS (4 tests)
// =============================================================================

describe("validate — PROFESSIONAL_HOURS", () => {
  const profMorningOnly: ProfessionalCapabilities = {
    professionalId: "dent-1",
    capabilities: { general_dentistry: 1 },
    workSchedule: {
      "1": { morningOpen: "09:00", morningClose: "13:00" },
    },
    hourlyCost: null,
  };

  const profSplit: ProfessionalCapabilities = {
    professionalId: "dent-1",
    capabilities: { general_dentistry: 1 },
    workSchedule: {
      "1": {
        morningOpen: "09:00",
        morningClose: "13:00",
        afternoonOpen: "15:00",
        afternoonClose: "20:00",
      },
    },
    hourlyCost: null,
  };

  it("cita dentro del tramo de mañana es válida", () => {
    const state = buildState([buildAppointment("a")]);
    const runtimes: AppointmentRuntimeMap = {
      a: {
        eventId: "a",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_1000_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-1",
        reservedEquipment: [],
      },
    };
    const ctx: ValidationContext = {
      ...emptyContext(),
      runtimes,
      professionals: [profMorningOnly],
    };
    const result = validate(state, NOOP, ctx);
    expect(result.valid).toBe(true);
  });

  it("cita dentro del tramo de tarde es válida", () => {
    const state = buildState([buildAppointment("a")]);
    const runtimes: AppointmentRuntimeMap = {
      a: {
        eventId: "a",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_1500_UTC + HOUR_MS,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-1",
        reservedEquipment: [],
      },
    };
    const ctx: ValidationContext = {
      ...emptyContext(),
      runtimes,
      professionals: [profSplit],
    };
    const result = validate(state, NOOP, ctx);
    expect(result.valid).toBe(true);
  });

  it("cita fuera de los tramos genera hard violation", () => {
    const state = buildState([buildAppointment("a")]);
    const runtimes: AppointmentRuntimeMap = {
      a: {
        eventId: "a",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_2200_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-1",
        reservedEquipment: [],
      },
    };
    const ctx: ValidationContext = {
      ...emptyContext(),
      runtimes,
      professionals: [profSplit],
    };
    const result = validate(state, NOOP, ctx);
    expect(result.valid).toBe(false);
    expect(result.hardViolations[0].code).toBe("PROFESSIONAL_HOURS");
  });

  it("profesional sin workSchedule no se valida (limitación v1)", () => {
    const state = buildState([buildAppointment("a")]);
    const runtimes: AppointmentRuntimeMap = {
      a: {
        eventId: "a",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_2200_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-1",
        reservedEquipment: [],
      },
    };
    const profNoSchedule: ProfessionalCapabilities = {
      professionalId: "dent-1",
      capabilities: { general_dentistry: 1 },
      workSchedule: null,
      hourlyCost: null,
    };
    const ctx: ValidationContext = {
      ...emptyContext(),
      runtimes,
      professionals: [profNoSchedule],
    };
    const result = validate(state, NOOP, ctx);
    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// RESOURCE_AVAILABILITY (3 tests)
// =============================================================================

describe("validate — RESOURCE_AVAILABILITY", () => {
  it("dos appointments reservando el mismo equipo en rangos solapados generan hard violation", () => {
    const state = buildState([buildAppointment("a"), buildAppointment("b")]);
    const runtimes: AppointmentRuntimeMap = {
      a: {
        eventId: "a",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_0900_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-1",
        reservedEquipment: [
          {
            equipmentId: "eq-scanner",
            fromMs: MONDAY_0900_UTC,
            toMs: MONDAY_0900_UTC + 30 * 60 * 1000,
          },
        ],
      },
      b: {
        eventId: "b",
        professionalId: "dent-2",
        roomId: "room-2",
        start: MONDAY_0900_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-2",
        reservedEquipment: [
          {
            equipmentId: "eq-scanner",
            fromMs: MONDAY_0900_UTC + 15 * 60 * 1000,
            toMs: MONDAY_0900_UTC + 45 * 60 * 1000,
          },
        ],
      },
    };
    const ctx: ValidationContext = { ...emptyContext(), runtimes };
    const result = validate(state, NOOP, ctx);
    expect(result.valid).toBe(false);
    expect(result.hardViolations[0].code).toBe("RESOURCE_AVAILABILITY");
    expect(result.hardViolations[0].affectedResourceIds).toContain("eq-scanner");
  });

  it("dos reservas del mismo equipo en rangos NO solapados son válidas", () => {
    const state = buildState([buildAppointment("a"), buildAppointment("b")]);
    const runtimes: AppointmentRuntimeMap = {
      a: {
        eventId: "a",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_0900_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-1",
        reservedEquipment: [
          {
            equipmentId: "eq-scanner",
            fromMs: MONDAY_0900_UTC,
            toMs: MONDAY_0900_UTC + 30 * 60 * 1000,
          },
        ],
      },
      b: {
        eventId: "b",
        professionalId: "dent-2",
        roomId: "room-2",
        start: MONDAY_1000_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-2",
        reservedEquipment: [
          {
            equipmentId: "eq-scanner",
            fromMs: MONDAY_1000_UTC,
            toMs: MONDAY_1000_UTC + 30 * 60 * 1000,
          },
        ],
      },
    };
    const ctx: ValidationContext = { ...emptyContext(), runtimes };
    const result = validate(state, NOOP, ctx);
    expect(result.valid).toBe(true);
  });

  it("dos reservas del mismo appointment con el mismo equipo no generan self-conflict", () => {
    const state = buildState([buildAppointment("a")]);
    const runtimes: AppointmentRuntimeMap = {
      a: {
        eventId: "a",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_0900_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-1",
        reservedEquipment: [
          {
            equipmentId: "eq-scanner",
            fromMs: MONDAY_0900_UTC,
            toMs: MONDAY_0900_UTC + 15 * 60 * 1000,
          },
          {
            equipmentId: "eq-scanner",
            fromMs: MONDAY_0900_UTC + 10 * 60 * 1000,
            toMs: MONDAY_0900_UTC + 30 * 60 * 1000,
          },
        ],
      },
    };
    const ctx: ValidationContext = { ...emptyContext(), runtimes };
    const result = validate(state, NOOP, ctx);
    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// CHAINING (4 tests)
// =============================================================================

describe("validate — CHAINING", () => {
  const procWithPrecondition: ProcedureRequirements = {
    procedureId: "proc-corona",
    procedureCode: "D2740",
    requiresProfessionalCapabilities: [],
    requiresRoomCapabilities: [],
    requiresEquipment: [],
    requiresAuxiliary: false,
    precondition: { requiredProcedureCode: "tallado_previo_corona" },
  };

  const procNoPrecondition: ProcedureRequirements = {
    procedureId: "proc-revision",
    procedureCode: "D0150",
    requiresProfessionalCapabilities: [],
    requiresRoomCapabilities: [],
    requiresEquipment: [],
    requiresAuxiliary: false,
    precondition: null,
  };

  it("precondición satisfecha en el historial → válido", () => {
    const state = buildState([buildAppointment("a")]);
    const runtimes: AppointmentRuntimeMap = {
      a: {
        eventId: "a",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_1000_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "proc-corona",
        patientId: "pat-1",
        reservedEquipment: [],
      },
    };
    const history: PatientHistory = {
      patientId: "pat-1",
      completedProcedures: [
        { procedureCode: "tallado_previo_corona", completedAt: MONDAY_0900_UTC },
      ],
    };
    const ctx: ValidationContext = {
      ...emptyContext(),
      runtimes,
      proceduresById: { "proc-corona": procWithPrecondition },
      patientHistoryById: { "pat-1": history },
    };
    const result = validate(state, NOOP, ctx);
    expect(result.valid).toBe(true);
  });

  it("precondición NO satisfecha → hard violation", () => {
    const state = buildState([buildAppointment("a")]);
    const runtimes: AppointmentRuntimeMap = {
      a: {
        eventId: "a",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_1000_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "proc-corona",
        patientId: "pat-1",
        reservedEquipment: [],
      },
    };
    const ctx: ValidationContext = {
      ...emptyContext(),
      runtimes,
      proceduresById: { "proc-corona": procWithPrecondition },
      patientHistoryById: {},
    };
    const result = validate(state, NOOP, ctx);
    expect(result.valid).toBe(false);
    expect(result.hardViolations[0].code).toBe("CHAINING");
  });

  it("procedimiento sin precondición no aplica regla", () => {
    const state = buildState([buildAppointment("a")]);
    const runtimes: AppointmentRuntimeMap = {
      a: {
        eventId: "a",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_1000_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "proc-revision",
        patientId: "pat-1",
        reservedEquipment: [],
      },
    };
    const ctx: ValidationContext = {
      ...emptyContext(),
      runtimes,
      proceduresById: { "proc-revision": procNoPrecondition },
      patientHistoryById: {},
    };
    const result = validate(state, NOOP, ctx);
    expect(result.valid).toBe(true);
  });

  it("precondición completada DESPUÉS del start de la cita → hard violation", () => {
    const state = buildState([buildAppointment("a")]);
    const runtimes: AppointmentRuntimeMap = {
      a: {
        eventId: "a",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_0900_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "proc-corona",
        patientId: "pat-1",
        reservedEquipment: [],
      },
    };
    const history: PatientHistory = {
      patientId: "pat-1",
      completedProcedures: [
        // Completado a las 10:00, pero la cita arranca a las 09:00 → no satisface
        { procedureCode: "tallado_previo_corona", completedAt: MONDAY_1000_UTC },
      ],
    };
    const ctx: ValidationContext = {
      ...emptyContext(),
      runtimes,
      proceduresById: { "proc-corona": procWithPrecondition },
      patientHistoryById: { "pat-1": history },
    };
    const result = validate(state, NOOP, ctx);
    expect(result.valid).toBe(false);
  });
});

// =============================================================================
// listCompatible (5 tests)
// =============================================================================

describe("listCompatible", () => {
  const procRequiresEndo: ProcedureRequirements = {
    procedureId: "proc-endo",
    procedureCode: "D3330",
    requiresProfessionalCapabilities: ["endodontics"],
    requiresRoomCapabilities: ["standard_treatment_room"],
    requiresEquipment: [{ equipmentType: "endodontic_motor", durationMinutes: 80 }],
    requiresAuxiliary: true,
    precondition: null,
  };

  const dentEndo: ProfessionalCapabilities = {
    professionalId: "dent-endo",
    capabilities: { endodontics: 0.9, general_dentistry: 1.0 },
    workSchedule: null,
    hourlyCost: null,
  };

  const dentGeneral: ProfessionalCapabilities = {
    professionalId: "dent-general",
    capabilities: { general_dentistry: 1.0 },
    workSchedule: null,
    hourlyCost: null,
  };

  const roomTreatment: RoomCapabilities = {
    roomId: "room-1",
    derivedCapabilities: { standard_treatment_room: true },
  };

  const roomSurgery: RoomCapabilities = {
    roomId: "room-surgery",
    derivedCapabilities: { surgery_room: true },
  };

  const eqEndo: EquipmentInfo = {
    equipmentId: "eq-endo-1",
    equipmentType: "endodontic_motor",
    modality: "mobile",
    compatibleRoomIds: ["room-1"],
  };

  const eqScanner: EquipmentInfo = {
    equipmentId: "eq-scanner-1",
    equipmentType: "intraoral_scanner",
    modality: "mobile",
    compatibleRoomIds: ["room-1"],
  };

  const apt = {
    eventId: "a",
    runtimeStatus: "scheduled" as const,
    estimatedEndDistribution: NEUTRAL_DIST,
    detectedRisks: {
      overrunProbability: 0,
      noShowProbability: 0,
      significantLatenessProbability: 0,
    },
  };

  it("professional: solo lista los que tienen TODAS las capacidades requeridas", () => {
    const ctx: ValidationContext = {
      ...emptyContext(),
      professionals: [dentEndo, dentGeneral],
      proceduresById: { "proc-endo": procRequiresEndo },
    };
    const result = listCompatible(apt, "proc-endo", "professional", ctx);
    expect(result).toEqual(["dent-endo"]);
  });

  it("professional: si nadie tiene la capacidad, devuelve lista vacía", () => {
    const ctx: ValidationContext = {
      ...emptyContext(),
      professionals: [dentGeneral],
      proceduresById: { "proc-endo": procRequiresEndo },
    };
    const result = listCompatible(apt, "proc-endo", "professional", ctx);
    expect(result).toEqual([]);
  });

  it("room: solo lista las que tienen la capacidad derivada requerida", () => {
    const ctx: ValidationContext = {
      ...emptyContext(),
      rooms: [roomTreatment, roomSurgery],
      proceduresById: { "proc-endo": procRequiresEndo },
    };
    const result = listCompatible(apt, "proc-endo", "room", ctx);
    expect(result).toEqual(["room-1"]);
  });

  it("equipment: solo lista los del tipo requerido", () => {
    const ctx: ValidationContext = {
      ...emptyContext(),
      equipment: [eqEndo, eqScanner],
      proceduresById: { "proc-endo": procRequiresEndo },
    };
    const result = listCompatible(apt, "proc-endo", "equipment", ctx);
    expect(result).toEqual(["eq-endo-1"]);
  });

  it("procedureId desconocido devuelve lista vacía", () => {
    const ctx: ValidationContext = {
      ...emptyContext(),
      professionals: [dentEndo],
      proceduresById: {},
    };
    const result = listCompatible(apt, "proc-fantasma", "professional", ctx);
    expect(result).toEqual([]);
  });
});

// =============================================================================
// validate — integración (1 test)
// =============================================================================

describe("validate — integración", () => {
  it("no_op sobre estado válido devuelve valid:true sin violaciones", () => {
    const state = buildState([buildAppointment("a")]);
    const runtimes: AppointmentRuntimeMap = {
      a: {
        eventId: "a",
        professionalId: "dent-1",
        roomId: "room-1",
        start: MONDAY_1000_UTC,
        plannedDuration: HOUR_MS,
        procedureId: "p-1",
        patientId: "pat-1",
        reservedEquipment: [],
      },
    };
    const ctx: ValidationContext = { ...emptyContext(), runtimes };
    const result = validate(state, NOOP, ctx);
    expect(result.valid).toBe(true);
    expect(result.hardViolations).toHaveLength(0);
    expect(result.softViolations).toHaveLength(0);
  });
});