/**
 * Adapter del clean core (Sesión 18).
 *
 * Pieza de unión entre Prisma (DB real) y el clean core (lib/core/).
 * Vive AQUÍ por convención (lib/core/) porque es agnóstica de UI/Next, pero
 * NO es parte del core puro: importa @/lib/prisma y conoce el schema dental
 * concreto. Es deliberadamente "feo" — el core es puro, el adapter es sucio.
 *
 * API pública:
 *
 *   buildContextsFromDb(currentInstantMs?: number): Promise<{
 *     state: DayState;
 *     runtimes: AppointmentRuntimeMap;
 *     contexts: CoordinatorContexts;
 *   }>
 *
 *   processEvent(event: EngineEvent, currentInstantMs?: number): Promise<CycleDecision>
 *
 * Multi-tenant: getCurrentClinicId() se llama una vez al inicio de cada
 * función pública. Todas las queries filtran por ese clinicId. Regla §7.7
 * del master.
 *
 * Ventana del día: replica getMadridDayBoundaries del route.ts legacy
 * (mitigación TZ-MADRID-VERCEL). El día se calcula en hora Madrid y se
 * convierte a UTC para el filtro Prisma. Sin esto, los appointments
 * almacenados como "medianoche Madrid expresada en UTC" (ej:
 * 2026-04-29T22:00:00Z = 30/04 00:00 Madrid en CEST) caen fuera de la ventana.
 *
 * Llamadas al Predictor:
 *   - predictDuration por cada appointment vivo (rellena
 *     estimatedEndDistribution).
 *   - predictNoShow / predictLateness por cada paciente (rellena
 *     detectedRisks).
 *   - predictAdviceAcceptance no se usa en v1 (el Coordinator no lo consume).
 *   - updateInProgress no se usa en v1 (requiere event in_progress_update
 *     que el adapter aún no procesa con esa semántica).
 *
 * Cierra parcialmente:
 *   - COORDINATOR-PREDICTOR-INTEGRATION-V1 (Sesión 17): el adapter pre-puebla
 *     riesgos antes de pasar el state al Coordinator.
 *
 * Deudas blandas registradas:
 *   - ADAPTER-OVERRUN-PROBABILITY-V1: no calculamos overrunProbability del
 *     Predictor en v1 (no hay API para ello en C1; el documento de lógica lo
 *     describe como derivable de p90/p50 ratio). Lo dejamos a 0 por ahora.
 *   - ADAPTER-EQUIPMENT-RESERVATIONS-V1: leemos AppointmentEquipment de DB
 *     y lo mapeamos a runtime.reservedEquipment, pero el cálculo de horarios
 *     es directo (no respeta setupTimeMs/cleanupTimeMs del Equipment). v2 los
 *     incorporará.
 *   - ADAPTER-PROCEDURE-MAPPING-FALLBACK-V1: appointments del seed legacy
 *     (que tienen treatmentTypeId pero no procedureId directo) se mapean a
 *     procedureId via el mapping TT_TO_PROCEDURE_CODE de
 *     migrate-procedure-references.ts. Si TT no está mapeado, el appointment
 *     se marca con procedureId="unknown" y el Simulator lo ignora para precios.
 *   - ADAPTER-PATIENT-HISTORY-EMPTY-V1: patientHistoryById se devuelve vacío
 *     en v1 (no leemos appointments completados pasados todavía). El
 *     Validator solo usa CHAINING para procedimientos con precondition, y
 *     esos no aparecen en el seed. Cuando aparezca un cliente real con
 *     coronas/implantes secuenciados, se rellena.
 *   - ADAPTER-WORKDAY-CONSTRAINTS-V1: ConstraintRule[] se ignora en v1 (la
 *     tabla está vacía en seed). El Validator solo usa las 4 reglas
 *     universales hardcoded. Cuando se introduzcan reglas custom por tenant,
 *     el adapter las leerá de DB.
 *   - ADAPTER-TZ-MADRID-DUPLICATED-V1: la lógica de getMadridDayBoundaries
 *     vive aquí Y en route.ts. Cuando se cierre TZ-MADRID-VERCEL (¿Sesión
 *     18.5?), unificar en un único helper compartido.
 */

import type {
  AppointmentState,
  AppointmentRuntimeStatus,
  CycleDecision,
  DayState,
  DurationDistribution,
  EngineEvent,
  KPIVector,
} from "./types";
import type { EventId, InstantUTC, ResourceId } from "./primitives";
import {
  predictDuration,
  predictLateness,
  predictNoShow,
} from "./predictor";
import type {
  DurationPredictionContext,
  PatientPredictiveScores,
  ProcedureDistributions,
} from "./predictor-types";
import type {
  AppointmentRuntime,
  AppointmentRuntimeMap,
} from "./state-transitions";
import type {
  EquipmentInfo,
  PatientHistory,
  ProcedureRequirements,
  ProfessionalCapabilities,
  RoomCapabilities,
  WorkSchedule,
} from "./domain-types";
import type { CoordinatorContexts } from "./coordinator-types";
import { runCycle } from "./coordinator";
import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";

// =============================================================================
// Mapping TreatmentType.name -> Procedure.code (sincronizado con
// scripts/migrate-procedure-references.ts).
// =============================================================================

const TT_TO_PROCEDURE_CODE: Readonly<Record<string, string>> = {
  Limpieza: "D1110",
  Revisión: "D0150",
  Empaste: "D2391",
  "Empaste x3": "D2391",
  Implante: "D6010",
  "Endodoncia unirradicular": "D3310",
  "Extracción simple": "D7140",
  "Extracción muela del juicio": "D7240",
  "Curetaje periodontal": "D4341",
  Blanqueamiento: "D9972",
};

const UNKNOWN_PROCEDURE_ID = "unknown";

// =============================================================================
// Helpers de timezone (replica de route.ts hasta cerrar TZ-MADRID-VERCEL)
// =============================================================================

/**
 * Devuelve los límites del día actual en zona Europe/Madrid, expresados como
 * Date UTC. Replica de getMadridDayBoundaries() de app/api/orbital-state/route.ts.
 *
 * Si hoy es 30/04/2026 en Madrid (CEST, UTC+2):
 *   today    = 2026-04-29T22:00:00.000Z (= 30/04 00:00 Madrid)
 *   tomorrow = 2026-04-30T22:00:00.000Z (= 01/05 00:00 Madrid)
 */
function getMadridDayBoundaries(now: Date): { today: Date; tomorrow: Date } {
  const dateStringMadrid = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
  }).format(now);

  const offsetParts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Madrid",
    timeZoneName: "longOffset",
  }).formatToParts(now);
  const offsetStr =
    offsetParts.find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") ||
    "+00:00";

  const today = new Date(`${dateStringMadrid}T00:00:00${offsetStr}`);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  return { today, tomorrow };
}

// =============================================================================
// Helpers de mapeo de tipos (DB -> clean core)
// =============================================================================

/**
 * Convierte minutos del catálogo a ProcedureDistributions consumible por
 * el Predictor. Asume invariantes I-8 ya validados al hacer seed.
 */
function buildProcedureDistributionsFromActivation(
  activation: {
    learnedDurationMean: number;
    learnedDurationStdDev: number;
    learnedDurationP10: number;
    learnedDurationP50: number;
    learnedDurationP90: number;
  },
): ProcedureDistributions {
  return {
    mean: activation.learnedDurationMean,
    stdDev: activation.learnedDurationStdDev,
    p10: activation.learnedDurationP10,
    p50: activation.learnedDurationP50,
    p90: activation.learnedDurationP90,
  };
}

function buildProcedureDistributionsFromProcedure(
  procedure: {
    referenceDurationMean: number;
    referenceDurationStdDev: number;
    referenceDurationP10: number;
    referenceDurationP50: number;
    referenceDurationP90: number;
  },
): ProcedureDistributions {
  return {
    mean: procedure.referenceDurationMean,
    stdDev: procedure.referenceDurationStdDev,
    p10: procedure.referenceDurationP10,
    p50: procedure.referenceDurationP50,
    p90: procedure.referenceDurationP90,
  };
}

/**
 * Mapea Appointment.status (string libre por convivencia v7.3 / clean core)
 * a AppointmentRuntimeStatus (union estricta del clean core).
 */
function mapStatusToRuntimeStatus(status: string): AppointmentRuntimeStatus {
  switch (status) {
    case "scheduled":
    case "confirmed":
    case "checked_in":
    case "in_progress":
    case "completed":
    case "cancelled":
    case "no_show":
      return status;
    case "delayed":
      return "confirmed"; // delayed legacy se trata como confirmed para el clean core
    default:
      return "scheduled";
  }
}

/**
 * Combina date (medianoche del día en Madrid expresada como UTC) + startTime
 * ("HH:MM" en hora Madrid) en un InstantUTC absoluto.
 *
 * El startTime se interpreta como hora local Madrid: las 09:00 de un appointment
 * son las 09:00 Madrid, que en UTC son 07:00 (verano CEST) o 08:00 (invierno CET).
 * Como `date` ya incluye el offset de Madrid (es 22:00 UTC del día anterior en CEST),
 * sumar startTime al timestamp produce el instante absoluto correcto.
 */
function combineDateAndStartTime(date: Date, startTime: string): InstantUTC {
  const [hh, mm] = startTime.split(":").map(Number);
  return date.getTime() + (hh * 60 + mm) * 60_000;
}

/**
 * Convierte BigInt a number con guardia de overflow. AppointmentEquipment
 * almacena BigInt en reservedFromMs/reservedToMs por compatibilidad de schema,
 * pero los valores reales caben sobradamente en Number (epoch ms).
 */
function bigIntToInstant(bi: bigint): InstantUTC {
  const n = Number(bi);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`BigInt overflow al convertir reservedFromMs/ToMs: ${bi}`);
  }
  return n;
}

/**
 * Parsea Dentist.workSchedule (Json en Prisma) a WorkSchedule del clean core.
 * Defensivo: si está corrupto o vacío, devuelve null (el Validator lo trata
 * como "sin info, no se viola" — patrón documentado).
 */
function parseWorkSchedule(json: unknown): WorkSchedule | null {
  if (json === null || json === undefined) return null;
  if (typeof json !== "object") return null;
  // Aceptamos cualquier shape que sea Record<string, ...>. Validación
  // estructural es responsabilidad del Validator (que usa parseHHMM y
  // tolera campos undefined).
  return json as WorkSchedule;
}

/**
 * Parsea Dentist.capabilities (Json en Prisma) a Record<string, number>.
 */
function parseCapabilityMap(json: unknown): Record<string, number> {
  if (json === null || json === undefined) return {};
  if (typeof json !== "object") return {};
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (typeof v === "number") result[k] = v;
    else if (typeof v === "boolean") result[k] = v ? 1 : 0;
  }
  return result;
}

// =============================================================================
// API pública — buildContextsFromDb
// =============================================================================

/**
 * Construye el state, runtimes y contexts del clean core leyendo de Prisma.
 *
 * @param currentInstantMs instante "ahora" del ciclo. Si no se proporciona,
 *   usa Date.now(). Útil en tests para fijar el reloj.
 */
export async function buildContextsFromDb(
  currentInstantMs?: number,
): Promise<{
  state: DayState;
  runtimes: AppointmentRuntimeMap;
  contexts: CoordinatorContexts;
}> {
  const clinicId = getCurrentClinicId();
  const now = currentInstantMs !== undefined ? new Date(currentInstantMs) : new Date();

  // --- Calcular ventana del día actual en hora Madrid ---
  const { today: todayStart, tomorrow: todayEnd } = getMadridDayBoundaries(now);

  // --- 6 queries en paralelo ---
  const [
    appointmentsRaw,
    dentistsRaw,
    gabinetesRaw,
    equipmentRaw,
    proceduresWithActivationsRaw,
    waitlistRaw,
  ] = await Promise.all([
    prisma.appointment.findMany({
      where: { clinicId, date: { gte: todayStart, lt: todayEnd } },
      include: {
        treatmentType: true,
        patient: true,
        reservedEquipment: true,
      },
      orderBy: [{ gabineteId: "asc" }, { startTime: "asc" }],
    }),
    prisma.dentist.findMany({
      where: { clinicId, active: true },
    }),
    prisma.gabinete.findMany({
      where: { clinicId, active: true },
      include: { equipment: { include: { equipment: true } } },
    }),
    prisma.equipment.findMany({
      where: { clinicId, active: true },
      include: { compatibleRooms: true },
    }),
    prisma.procedureActivation.findMany({
      where: { clinicId, active: true },
      include: { procedure: true },
    }),
    prisma.waitlistEntry.findMany({
      where: { clinicId, availableNow: true },
      include: {
        patient: true,
        desiredProcedure: true,
        desiredTreatmentType: true,
      },
    }),
  ]);

  // --- Resolver Procedure por code (necesario para mapping TT->code) ---
  const procedureIdByCode: Record<string, number> = {};
  const procedureRequirementsById: Record<ResourceId, ProcedureRequirements> = {};
  const distributionsByProcedureId: Record<ResourceId, ProcedureDistributions> = {};
  const priceByProcedureId: Record<ResourceId, number> = {};

  for (const act of proceduresWithActivationsRaw) {
    const proc = act.procedure;
    procedureIdByCode[proc.code] = proc.id;

    const procIdStr = String(proc.id);
    procedureRequirementsById[procIdStr] = {
      procedureId: procIdStr,
      procedureCode: proc.code,
      requiresProfessionalCapabilities: Object.keys(
        proc.requiresProfessionalCapabilities as Record<string, unknown>,
      ),
      requiresRoomCapabilities: Object.keys(
        proc.requiresRoomCapabilities as Record<string, unknown>,
      ),
      requiresEquipment: Array.isArray(proc.requiresEquipment)
        ? (proc.requiresEquipment as Array<{
            type: string;
            durationMinutes: number;
          }>).map((e) => ({
            equipmentType: e.type,
            durationMinutes: e.durationMinutes,
          }))
        : [],
      requiresAuxiliary: proc.requiresAuxiliary,
      precondition: null, // v1 no parsea clinicalDependencies aún
    };

    distributionsByProcedureId[procIdStr] =
      buildProcedureDistributionsFromActivation(act);

    if (act.price !== null) {
      priceByProcedureId[procIdStr] = act.price;
    }
  }

  // --- Mapear professionals ---
  const professionals: ProfessionalCapabilities[] = dentistsRaw.map((d) => ({
    professionalId: String(d.id),
    capabilities: parseCapabilityMap(d.capabilities),
    workSchedule: parseWorkSchedule(d.workSchedule),
    hourlyCost: d.hourlyCost,
  }));

  // --- Mapear rooms (deriva capabilities desde equipment fijo en sala) ---
  const rooms: RoomCapabilities[] = gabinetesRaw.map((g) => {
    const derived: Record<string, boolean> = {};
    for (const er of g.equipment) {
      if (er.equipment.modality === "fixed_in_room") {
        derived[er.equipment.type] = true;
      }
    }
    derived["standard_treatment_room"] = true; // todos los gabinetes son standard
    return {
      roomId: String(g.id),
      derivedCapabilities: derived,
    };
  });

  // --- Mapear equipment ---
  const equipment: EquipmentInfo[] = equipmentRaw.map((e) => ({
    equipmentId: String(e.id),
    equipmentType: e.type,
    modality: e.modality,
    compatibleRoomIds: e.compatibleRooms.map((cr) => String(cr.gabineteId)),
  }));

  // --- Helper: mapear treatmentTypeId del appointment a procedureId ---
  function resolveProcedureIdForAppointment(
    treatmentTypeName: string,
  ): ResourceId {
    const code = TT_TO_PROCEDURE_CODE[treatmentTypeName];
    if (code === undefined) return UNKNOWN_PROCEDURE_ID;
    const id = procedureIdByCode[code];
    if (id === undefined) return UNKNOWN_PROCEDURE_ID;
    return String(id);
  }

  // --- Construir AppointmentState[] + AppointmentRuntimeMap ---
  const appointments: AppointmentState[] = [];
  const runtimes: Record<EventId, AppointmentRuntime> = {};

  for (const a of appointmentsRaw) {
    const eventIdStr = String(a.id);
    const startMs = combineDateAndStartTime(a.date, a.startTime);
    const procedureId = resolveProcedureIdForAppointment(a.treatmentType.name);

    // Predictor inputs: distribution para esta cita.
    // Si el procedureId es desconocido, usamos una distribución degenerada
    // basada en a.duration (minutos) como fallback. No pretende ser predictivo
    // — solo sirve para que el Simulator no explote.
    let estimatedEndDistribution: DurationDistribution;
    if (procedureId === UNKNOWN_PROCEDURE_ID) {
      const durationMs = a.duration * 60_000;
      estimatedEndDistribution = {
        mean: durationMs,
        stdDev: 0,
        p10: durationMs,
        p50: durationMs,
        p90: durationMs,
      };
    } else {
      const procDistMinutes = distributionsByProcedureId[procedureId];
      const procReqs = procedureRequirementsById[procedureId];
      // Construir un Procedure mínimo para el Predictor.
      const dummyProcedureForPredictor = {
        procedureId: procedureId,
        procedureCode: procReqs.procedureCode,
        referenceDistribution: procDistMinutes,
      };
      // Activation con learnedDistribution igual a la del catálogo (cold start).
      const dummyActivation = {
        procedureId: procedureId,
        tenantId: String(clinicId),
        learnedDistribution: procDistMinutes,
      };
      const ctx: DurationPredictionContext = {
        procedure: dummyProcedureForPredictor,
        activation: dummyActivation,
      };
      estimatedEndDistribution = predictDuration(ctx);
    }

    // Predictor inputs: scores del paciente.
    const patientScores: PatientPredictiveScores = {
      patientId: String(a.patientId),
      noShowScore: a.patient.noShowScore,
      latenessMeanMinutes: a.patient.latenessMeanMinutes,
      latenessStdDevMinutes: a.patient.latenessStdDevMinutes,
      acceptAdviceScore: a.patient.acceptAdviceScore,
    };
    const noShowProbability = predictNoShow(patientScores);
    const latenessDist = predictLateness(patientScores);
    // significantLatenessProbability: prob de llegar > 10 min tarde.
    // Aproximación: si p90 > 10 min, riesgo proporcional al exceso.
    const TEN_MIN_MS = 10 * 60_000;
    const significantLatenessProbability =
      latenessDist.p90 > TEN_MIN_MS
        ? Math.min(0.5, (latenessDist.p90 - TEN_MIN_MS) / (TEN_MIN_MS * 5))
        : 0;
    // overrunProbability: deuda blanda ADAPTER-OVERRUN-PROBABILITY-V1, queda 0.
    const overrunProbability = 0;

    appointments.push({
      eventId: eventIdStr,
      runtimeStatus: mapStatusToRuntimeStatus(a.status),
      estimatedEndDistribution,
      detectedRisks: {
        overrunProbability,
        noShowProbability,
        significantLatenessProbability,
      },
    });

    runtimes[eventIdStr] = {
      eventId: eventIdStr,
      professionalId: String(a.dentistId),
      roomId: String(a.gabineteId),
      start: startMs,
      plannedDuration: a.duration * 60_000,
      procedureId,
      patientId: String(a.patientId),
      reservedEquipment: a.reservedEquipment.map((re) => ({
        equipmentId: String(re.equipmentId),
        fromMs: bigIntToInstant(re.reservedFromMs),
        toMs: bigIntToInstant(re.reservedToMs),
      })),
    };
  }

  // --- Construir DayState ---
  const emptyKPIs: KPIVector = {
    effectiveUtilization: 0,
    expectedOvertime: 0,
    meanWaitTime: 0,
    expectedForcedCancellations: 0,
    projectedBillableValue: 0,
    risk: 0,
  };
  const state: DayState = {
    tenantId: String(clinicId),
    date: todayStart.getTime(),
    currentInstant: now.getTime(),
    rooms: rooms.map((r) => ({
      roomId: r.roomId,
      occupiedRanges: [],
      nextAvailableAt: null,
    })),
    professionals: professionals.map((p) => ({
      professionalId: p.professionalId,
      remainingAvailability: [],
      currentAppointmentId: null,
      accumulatedTodayMs: 0,
    })),
    equipment: equipment.map((e) => ({
      equipmentId: e.equipmentId,
      currentLocation: null,
      reservations: [],
      nextAvailableAt: null,
    })),
    appointments,
    pendingEvents: [],
    currentProjectedKPIs: emptyKPIs,
  };

  // --- Construir waitingCandidates para GenerationContext ---
  const waitingCandidates = waitlistRaw.map((w) => {
    // Resolvemos procedureId: si desiredProcedureId está poblado, lo usamos;
    // si no, intentamos via desiredTreatmentType.name (fallback al mapping).
    let procedureIdStr: string | undefined;
    if (w.desiredProcedureId !== null) {
      procedureIdStr = String(w.desiredProcedureId);
    } else if (w.desiredTreatmentType !== null) {
      const code = TT_TO_PROCEDURE_CODE[w.desiredTreatmentType.name];
      if (code !== undefined) {
        const id = procedureIdByCode[code];
        if (id !== undefined) procedureIdStr = String(id);
      }
    }

    return {
      id: String(w.id),
      preferredResourceId: undefined,
      desiredDuration: w.durationSlots * 30 * 60_000,
      value: w.value,
      priority: w.priority / 5, // schema 1-5, clean core 0-1
      easeScore: w.easeScore / 5,
      availableNow: w.availableNow,
      externalRefs: ((): Readonly<Record<string, string>> => {
        const refs: Record<string, string> = {
          patientId: String(w.patientId),
        };
        if (procedureIdStr !== undefined) {
          refs.procedureId = procedureIdStr;
        }
        return refs;
      })(),
    };
  });

  // --- Construir los 3 contexts ---
  const validation = {
    runtimes,
    professionals,
    rooms,
    equipment,
    proceduresById: procedureRequirementsById,
    patientHistoryById: {} as Readonly<Record<ResourceId, PatientHistory>>,
  };

  const contexts: CoordinatorContexts = {
    generation: {
      validation,
      waitlist: { candidates: waitingCandidates },
      estimatedDistributionByProcedureId: Object.fromEntries(
        Object.entries(distributionsByProcedureId).map(([k, v]) => [
          k,
          {
            mean: v.mean * 60_000,
            stdDev: v.stdDev * 60_000,
            p10: v.p10 * 60_000,
            p50: v.p50 * 60_000,
            p90: v.p90 * 60_000,
          },
        ]),
      ),
    },
    validation,
    simulation: {
      runtimes,
      professionals,
      equipment,
      proceduresById: procedureRequirementsById,
      priceByProcedureId,
    },
  };

  return { state, runtimes, contexts };
}

// =============================================================================
// API pública — processEvent
// =============================================================================

/**
 * Procesa un EngineEvent completo: carga state desde DB, llama a runCycle,
 * devuelve la decisión.
 *
 * @param event evento de entrada del motor.
 * @param currentInstantMs instante "ahora" del ciclo. Si no se proporciona,
 *   usa Date.now().
 */
export async function processEvent(
  event: EngineEvent,
  currentInstantMs?: number,
): Promise<CycleDecision> {
  const { state, runtimes, contexts } = await buildContextsFromDb(
    currentInstantMs,
  );
  return runCycle(event, state, runtimes, contexts);
}