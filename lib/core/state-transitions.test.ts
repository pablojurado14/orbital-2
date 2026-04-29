/**
 * Tests de state-transitions — Sesión 13 sub-fase 13.4.
 *
 * 4 tests cubriendo el aplicador de CompositeAction al DayState:
 *  1. no_op no cambia nada (verifica pureza estructural).
 *  2. move muta start + roomId del runtime sin tocar otros.
 *  3. compress muta plannedDuration y escala estimatedEndDistribution.
 *  4. composición de varias primitivas se aplica en orden.
 *
 * Convención: los fixtures construyen un DayState mínimo con 2 appointments
 * para tener algo sobre lo que iterar.
 */

import { describe, it, expect } from "vitest";
import {
  applyPrimitive,
  applyComposite,
  UnsupportedPrimitiveError,
  UnknownEventError,
  type AppointmentRuntimeMap,
} from "./state-transitions";
import type {
  DayState,
  AppointmentState,
  CompositeAction,
  KPIVector,
} from "./types";

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

function buildAppointmentState(eventId: string): AppointmentState {
  return {
    eventId,
    runtimeStatus: "scheduled",
    estimatedEndDistribution: {
      mean: 30 * 60 * 1000,
      stdDev: 5 * 60 * 1000,
      p10: 20 * 60 * 1000,
      p50: 30 * 60 * 1000,
      p90: 40 * 60 * 1000,
    },
    detectedRisks: {
      overrunProbability: 0,
      noShowProbability: 0,
      significantLatenessProbability: 0,
    },
  };
}

function buildState(): DayState {
  return {
    tenantId: "1",
    date: 1730160000000,
    currentInstant: 1730196000000,
    rooms: [],
    professionals: [],
    equipment: [],
    appointments: [buildAppointmentState("apt-1"), buildAppointmentState("apt-2")],
    pendingEvents: [],
    currentProjectedKPIs: ZERO_KPIS,
  };
}

function buildRuntimes(): AppointmentRuntimeMap {
  return {
    "apt-1": {
      eventId: "apt-1",
      professionalId: "dent-1",
      roomId: "room-1",
      start: 1730196000000,
      plannedDuration: 30 * 60 * 1000,
      procedureId: "proc-1",
      patientId: "pat-1",
      reservedEquipment: [],
    },
    "apt-2": {
      eventId: "apt-2",
      professionalId: "dent-2",
      roomId: "room-2",
      start: 1730199600000,
      plannedDuration: 60 * 60 * 1000,
      procedureId: "proc-2",
      patientId: "pat-2",
      reservedEquipment: [],
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("state-transitions", () => {
  it("no_op no muta state ni runtimes", () => {
    const state = buildState();
    const runtimes = buildRuntimes();
    const out = applyPrimitive(state, runtimes, { kind: "no_op" });
    expect(out.state).toBe(state);
    expect(out.runtimes).toBe(runtimes);
  });

  it("move muta start + roomId del runtime objetivo, deja los demás intactos", () => {
    const state = buildState();
    const runtimes = buildRuntimes();
    const newStart = 1730203200000;
    const out = applyPrimitive(state, runtimes, {
      kind: "move",
      eventId: "apt-1",
      newStart,
      newResourceId: "room-3",
    });
    expect(out.runtimes["apt-1"].start).toBe(newStart);
    expect(out.runtimes["apt-1"].roomId).toBe("room-3");
    expect(out.runtimes["apt-1"].professionalId).toBe("dent-1");
    expect(out.runtimes["apt-2"]).toBe(runtimes["apt-2"]);
  });

  it("compress muta plannedDuration y escala estimatedEndDistribution", () => {
    const state = buildState();
    const runtimes = buildRuntimes();
    const out = applyPrimitive(state, runtimes, {
      kind: "compress",
      eventId: "apt-1",
      newDuration: 15 * 60 * 1000,
    });
    expect(out.runtimes["apt-1"].plannedDuration).toBe(15 * 60 * 1000);
    const apt1 = out.state.appointments.find((a) => a.eventId === "apt-1")!;
    // factor = 15/30 = 0.5 → mean original 30 min → ahora 15 min
    expect(apt1.estimatedEndDistribution.mean).toBeCloseTo(15 * 60 * 1000, 5);
    expect(apt1.estimatedEndDistribution.p50).toBeCloseTo(15 * 60 * 1000, 5);
    expect(apt1.estimatedEndDistribution.p90).toBeCloseTo(20 * 60 * 1000, 5);
    // El otro appointment no se toca
    const apt2 = out.state.appointments.find((a) => a.eventId === "apt-2")!;
    expect(apt2).toBe(state.appointments[1]);
  });

  it("composición secuencial: move + reassign_professional aplican en orden", () => {
    const state = buildState();
    const runtimes = buildRuntimes();
    const composite: CompositeAction = [
      {
        kind: "move",
        eventId: "apt-1",
        newStart: 1730210000000,
        newResourceId: "room-5",
      },
      {
        kind: "reassign_professional",
        eventId: "apt-1",
        newProfessionalId: "dent-9",
      },
    ];
    const out = applyComposite(state, runtimes, composite);
    expect(out.runtimes["apt-1"].start).toBe(1730210000000);
    expect(out.runtimes["apt-1"].roomId).toBe("room-5");
    expect(out.runtimes["apt-1"].professionalId).toBe("dent-9");
  });

  it("primitivas no soportadas lanzan UnsupportedPrimitiveError", () => {
    const state = buildState();
    const runtimes = buildRuntimes();
    expect(() =>
      applyPrimitive(state, runtimes, {
        kind: "fill_from_waitlist",
        waitingCandidateId: "w-1",
        gapStart: 1730196000000,
        gapResourceId: "room-1",
        proposedDuration: 30 * 60 * 1000,
      }),
    ).toThrow(UnsupportedPrimitiveError);
  });

  it("eventId inexistente lanza UnknownEventError", () => {
    const state = buildState();
    const runtimes = buildRuntimes();
    expect(() =>
      applyPrimitive(state, runtimes, {
        kind: "advance",
        eventId: "apt-no-existe",
        newStart: 1730203200000,
      }),
    ).toThrow(UnknownEventError);
  });
});