/**
 * Adapter del clean core (Sesión 18 + 18.5 + 18.6).
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
 *     coordinatorOptions: CoordinatorOptions;
 *     legacyMeta: LegacyMetadata;
 *   }>
 *
 *   processEvent(event: EngineEvent, currentInstantMs?: number): Promise<CycleDecision>
 *
 *   processEventForLegacyApi(
 *     event: EngineEvent,
 *     persistedDecision: SuggestionDecision,
 *     legacyAppointments: Appointment[],
 *     currentInstantMs?: number,
 *   ): Promise<OrbitalState>
 *
 * Multi-tenant: await getCurrentClinicId() se llama una vez al inicio de cada
 * función pública. Todas las queries filtran por ese clinicId. Regla §7.7
 * del master.
 *
 * Sesión 18.5 — cambios:
 *   - applyEventToState pre-aplica cancellation/no_show_detected al state.
 *   - buildContextsFromDb lee ClinicSettings.umbralDisparoProactivo como
 *     improvementThreshold (decisión rectora 10).
 *   - buildContextsFromDb expone también legacyMeta con nombres legibles.
 *   - processEventForLegacyApi traduce CycleDecision a OrbitalState legacy.
 *   - cycleDecisionToOrbitalState pone status="confirmed" cuando
 *     decision === "accepted" (mejora UX respecto al v7.3).
 *
 * Sesión 18.6 — cambios:
 *   - Nueva 8ª query a RejectedCandidate en buildContextsFromDb.
 *   - filterWaitlistByRejectedCandidates excluye candidatas rechazadas para
 *     el gapEventId actual antes de pasar al Coordinator.
 *   - buildLegacySuggestion rellena los campos nuevos suggestion.gapEventId
 *     y suggestion.waitingCandidateId (decisión rectora 11) para que la UI
 *     pueda referenciarlos al rechazar candidata específica.
 *
 * Decisiones rectoras nuevas (S18.6):
 *   - 11: el gap se identifica por Appointment.id stringificado.
 *   - 12: §7.3 (no tocar lib/orbital-engine.ts) relajada porque el v7.3 ya
 *     no sirve respuestas tras flag flippeado en S18.5. Tipos compartidos
 *     se pueden extender; lógica del v7.3 sigue intocable hasta S19.
 *
 * Deudas blandas registradas (vigentes):
 *   - ADAPTER-OVERRUN-PROBABILITY-V1
 *   - ADAPTER-EQUIPMENT-RESERVATIONS-V1
 *   - ADAPTER-PROCEDURE-MAPPING-FALLBACK-V1
 *   - ADAPTER-PATIENT-HISTORY-EMPTY-V1
 *   - ADAPTER-WORKDAY-CONSTRAINTS-V1
 *   - ADAPTER-TZ-MADRID-DUPLICATED-V1
 *   - CLINIC-SETTINGS-FIELD-NAMING-V1
 *   - LEGACY-TRANSLATION-BREAKDOWN-PLACEHOLDER-V1 (S18.5)
 *   - LEGACY-TRANSLATION-EVENTS-EMPTY-V1 (S18.5)
 *   - REJECTED-CANDIDATE-HOUSEKEEPING-NOT-IN-ADAPTER-V1 (S18.6)
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
import type {
  CoordinatorContexts,
  CoordinatorOptions,
} from "./coordinator-types";
import { runCycle } from "./coordinator";
import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import type {
  OrbitalState,
  Suggestion,
  SuggestionDecision,
} from "@/lib/types/orbital-state";
import type {
  Appointment,
  AppointmentStatus,
  RankedCandidate,
} from "@/data/mock";

// =============================================================================
// Mapping TreatmentType.name -> Procedure.code
// =============================================================================

const TT_TO_PROCEDURE_CODE: Readonly<Record<string, string>> = {
  Limpieza: "D1110",
  Revisión: "D0150",
  "Revisión de implante": "D0150",
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

const ADAPTER_DEFAULT_IMPROVEMENT_THRESHOLD = 0.001;

// =============================================================================
// Tipos privados
// =============================================================================

interface LegacyMetadata {
  readonly procedureNameById: Readonly<Record<ResourceId, string>>;
  readonly roomNameById: Readonly<Record<ResourceId, string>>;
  readonly patientNameByWaitlistEntryId: Readonly<Record<string, string>>;
  readonly waitlistTreatmentByEntryId: Readonly<Record<string, string>>;
  readonly waitlistDurationSlotsByEntryId: Readonly<Record<string, number>>;
  readonly waitlistValueByEntryId: Readonly<Record<string, number>>;
}

type RejectedByGap = Readonly<Record<string, ReadonlySet<string>>>;

// =============================================================================
// Helpers de timezone
// =============================================================================

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
// Helpers de mapeo de tipos
// =============================================================================

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
      return "confirmed";
    default:
      return "scheduled";
  }
}

function combineDateAndStartTime(date: Date, startTime: string): InstantUTC {
  const [hh, mm] = startTime.split(":").map(Number);
  return date.getTime() + (hh * 60 + mm) * 60_000;
}

function bigIntToInstant(bi: bigint): InstantUTC {
  const n = Number(bi);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`BigInt overflow al convertir reservedFromMs/ToMs: ${bi}`);
  }
  return n;
}

function parseWorkSchedule(json: unknown): WorkSchedule | null {
  if (json === null || json === undefined) return null;
  if (typeof json !== "object") return null;
  return json as WorkSchedule;
}

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
// applyEventToState
// =============================================================================

function applyEventToState(event: EngineEvent, state: DayState): DayState {
  switch (event.kind) {
    case "cancellation":
      return markAppointmentRuntimeStatus(state, event.eventId, "cancelled");
    case "no_show_detected":
      return markAppointmentRuntimeStatus(state, event.eventId, "no_show");
    default:
      return state;
  }
}

function markAppointmentRuntimeStatus(
  state: DayState,
  eventId: EventId,
  targetStatus: AppointmentRuntimeStatus,
): DayState {
  const idx = state.appointments.findIndex((a) => a.eventId === eventId);
  if (idx === -1) return state;
  if (state.appointments[idx].runtimeStatus === targetStatus) return state;

  const updatedAppointment: AppointmentState = {
    ...state.appointments[idx],
    runtimeStatus: targetStatus,
  };
  const newAppointments = [
    ...state.appointments.slice(0, idx),
    updatedAppointment,
    ...state.appointments.slice(idx + 1),
  ];
  return { ...state, appointments: newAppointments };
}

// =============================================================================
// Filtrado de waitlist por candidatas rechazadas (S18.6)
// =============================================================================

function filterWaitlistByRejectedCandidates(
  contexts: CoordinatorContexts,
  rejectedByGap: RejectedByGap,
  gapEventId: string | null,
): CoordinatorContexts {
  if (gapEventId === null) return contexts;
  const rejectedSet = rejectedByGap[gapEventId];
  if (rejectedSet === undefined || rejectedSet.size === 0) return contexts;

  const filteredCandidates = contexts.generation.waitlist.candidates.filter(
    (c) => !rejectedSet.has(c.id),
  );
  if (filteredCandidates.length === contexts.generation.waitlist.candidates.length) {
    return contexts;
  }

  return {
    ...contexts,
    generation: {
      ...contexts.generation,
      waitlist: { candidates: filteredCandidates },
    },
  };
}

function extractGapEventId(event: EngineEvent): string | null {
  if (event.kind === "cancellation") {
    return event.eventId;
  }
  return null;
}

// =============================================================================
// API pública — buildContextsFromDb
// =============================================================================

export async function buildContextsFromDb(
  currentInstantMs?: number,
): Promise<{
  state: DayState;
  runtimes: AppointmentRuntimeMap;
  contexts: CoordinatorContexts;
  coordinatorOptions: CoordinatorOptions;
  legacyMeta: LegacyMetadata;
}> {
  const result = await buildContextsFromDbInternal(currentInstantMs);
  return {
    state: result.state,
    runtimes: result.runtimes,
    contexts: result.contexts,
    coordinatorOptions: result.coordinatorOptions,
    legacyMeta: result.legacyMeta,
  };
}

async function buildContextsFromDbInternal(
  currentInstantMs?: number,
): Promise<{
  state: DayState;
  runtimes: AppointmentRuntimeMap;
  contexts: CoordinatorContexts;
  coordinatorOptions: CoordinatorOptions;
  legacyMeta: LegacyMetadata;
  rejectedByGap: RejectedByGap;
}> {
  const clinicId = currentInstantMs !== undefined && (globalThis as { __ORBITAL_OVERRIDE_CLINIC_ID__?: number }).__ORBITAL_OVERRIDE_CLINIC_ID__ !== undefined
    ? (globalThis as { __ORBITAL_OVERRIDE_CLINIC_ID__?: number }).__ORBITAL_OVERRIDE_CLINIC_ID__!
    : await getCurrentClinicId();
  
  const now = currentInstantMs !== undefined ? new Date(currentInstantMs) : new Date();

  const { today: todayStart, tomorrow: todayEnd } = getMadridDayBoundaries(now);

  const [
    appointmentsRaw,
    dentistsRaw,
    gabinetesRaw,
    equipmentRaw,
    proceduresWithActivationsRaw,
    waitlistRaw,
    clinicSettingsRaw,
    rejectedCandidatesRaw,
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
    prisma.clinicSettings.findUnique({
      where: { id: clinicId },
      select: { umbralDisparoProactivo: true },
    }),
    prisma.rejectedCandidate.findMany({
      where: { clinicId },
      select: { gapEventId: true, waitingCandidateId: true },
    }),
  ]);

  const rejectedByGapMutable: Record<string, Set<string>> = {};
  for (const r of rejectedCandidatesRaw) {
    if (rejectedByGapMutable[r.gapEventId] === undefined) {
      rejectedByGapMutable[r.gapEventId] = new Set();
    }
    rejectedByGapMutable[r.gapEventId].add(r.waitingCandidateId);
  }
  const rejectedByGap: RejectedByGap = rejectedByGapMutable;

  const procedureIdByCode: Record<string, number> = {};
  const procedureRequirementsById: Record<ResourceId, ProcedureRequirements> = {};
  const distributionsByProcedureId: Record<ResourceId, ProcedureDistributions> = {};
  const priceByProcedureId: Record<ResourceId, number> = {};
  const ttNameByProcedureCode: Record<string, string> = {};
  for (const [ttName, procCode] of Object.entries(TT_TO_PROCEDURE_CODE)) {
    if (!(procCode in ttNameByProcedureCode)) {
      ttNameByProcedureCode[procCode] = ttName;
    }
  }
  const procedureNameById: Record<ResourceId, string> = {};

  for (const act of proceduresWithActivationsRaw) {
    const proc = act.procedure;
    procedureIdByCode[proc.code] = proc.id;

    const procIdStr = String(proc.id);
    procedureNameById[procIdStr] =
      ttNameByProcedureCode[proc.code] ?? proc.code;

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
      precondition: null,
    };

    distributionsByProcedureId[procIdStr] =
      buildProcedureDistributionsFromActivation(act);

    if (act.price !== null) {
      priceByProcedureId[procIdStr] = act.price;
    }
  }

  const professionals: ProfessionalCapabilities[] = dentistsRaw.map((d) => ({
    professionalId: String(d.id),
    capabilities: parseCapabilityMap(d.capabilities),
    workSchedule: parseWorkSchedule(d.workSchedule),
    hourlyCost: d.hourlyCost,
  }));

  const rooms: RoomCapabilities[] = gabinetesRaw.map((g) => {
    const derived: Record<string, boolean> = {};
    for (const er of g.equipment) {
      if (er.equipment.modality === "fixed_in_room") {
        derived[er.equipment.type] = true;
      }
    }
    derived["standard_treatment_room"] = true;
    return {
      roomId: String(g.id),
      derivedCapabilities: derived,
    };
  });

  const roomNameById: Record<ResourceId, string> = {};
  for (const g of gabinetesRaw) {
    roomNameById[String(g.id)] = g.name;
  }

  const equipment: EquipmentInfo[] = equipmentRaw.map((e) => ({
    equipmentId: String(e.id),
    equipmentType: e.type,
    modality: e.modality,
    compatibleRoomIds: e.compatibleRooms.map((cr) => String(cr.gabineteId)),
  }));

  function resolveProcedureIdForAppointment(
    treatmentTypeName: string,
  ): ResourceId {
    const code = TT_TO_PROCEDURE_CODE[treatmentTypeName];
    if (code === undefined) return UNKNOWN_PROCEDURE_ID;
    const id = procedureIdByCode[code];
    if (id === undefined) return UNKNOWN_PROCEDURE_ID;
    return String(id);
  }

  const appointments: AppointmentState[] = [];
  const runtimes: Record<EventId, AppointmentRuntime> = {};

  for (const a of appointmentsRaw) {
    const eventIdStr = String(a.id);
    const startMs = combineDateAndStartTime(a.date, a.startTime);
    const procedureId = resolveProcedureIdForAppointment(a.treatmentType.name);

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
      const dummyProcedureForPredictor = {
        procedureId: procedureId,
        procedureCode: procReqs.procedureCode,
        referenceDistribution: procDistMinutes,
      };
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

    const patientScores: PatientPredictiveScores = {
      patientId: String(a.patientId),
      noShowScore: a.patient.noShowScore,
      latenessMeanMinutes: a.patient.latenessMeanMinutes,
      latenessStdDevMinutes: a.patient.latenessStdDevMinutes,
      acceptAdviceScore: a.patient.acceptAdviceScore,
    };
    const noShowProbability = predictNoShow(patientScores);
    const latenessDist = predictLateness(patientScores);
    const TEN_MIN_MS = 10 * 60_000;
    const significantLatenessProbability =
      latenessDist.p90 > TEN_MIN_MS
        ? Math.min(0.5, (latenessDist.p90 - TEN_MIN_MS) / (TEN_MIN_MS * 5))
        : 0;
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

  const patientNameByWaitlistEntryId: Record<string, string> = {};
  const waitlistTreatmentByEntryId: Record<string, string> = {};
  const waitlistDurationSlotsByEntryId: Record<string, number> = {};
  const waitlistValueByEntryId: Record<string, number> = {};

  const waitingCandidates = waitlistRaw.map((w) => {
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

    const wIdStr = String(w.id);
    patientNameByWaitlistEntryId[wIdStr] = w.patient.name;
    let treatmentDisplay = "Sin tratamiento";
    if (procedureIdStr !== undefined && procedureIdStr in procedureNameById) {
      treatmentDisplay = procedureNameById[procedureIdStr];
    } else if (w.desiredTreatmentType !== null) {
      treatmentDisplay = w.desiredTreatmentType.name;
    }
    waitlistTreatmentByEntryId[wIdStr] = treatmentDisplay;
    waitlistDurationSlotsByEntryId[wIdStr] = w.durationSlots;
    waitlistValueByEntryId[wIdStr] = w.value;


    return {
      id: wIdStr,
      preferredResourceId: undefined,
      desiredDuration: w.durationSlots * 30 * 60_000,
      value: w.value,
      priority: w.priority / 5,
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

  const improvementThreshold =
    clinicSettingsRaw?.umbralDisparoProactivo ??
    ADAPTER_DEFAULT_IMPROVEMENT_THRESHOLD;
  const coordinatorOptions: CoordinatorOptions = {
    improvementThreshold,
  };

  const legacyMeta: LegacyMetadata = {
    procedureNameById,
    roomNameById,
    patientNameByWaitlistEntryId,
    waitlistTreatmentByEntryId,
    waitlistDurationSlotsByEntryId,
    waitlistValueByEntryId,
  };

  return {
    state,
    runtimes,
    contexts,
    coordinatorOptions,
    legacyMeta,
    rejectedByGap,
  };
}

// =============================================================================
// API pública — processEvent
// =============================================================================

export async function processEvent(
  event: EngineEvent,
  currentInstantMs?: number,
): Promise<CycleDecision> {
  const { state, runtimes, contexts, coordinatorOptions, rejectedByGap } =
    await buildContextsFromDbInternal(currentInstantMs);
  const stateAfterEvent = applyEventToState(event, state);
  const filteredContexts = filterWaitlistByRejectedCandidates(
    contexts,
    rejectedByGap,
    extractGapEventId(event),
  );
  return runCycle(
    event,
    stateAfterEvent,
    runtimes,
    filteredContexts,
    coordinatorOptions,
  );
}

// =============================================================================
// API pública — processEventForLegacyApi
// =============================================================================

export async function processEventForLegacyApi(
  event: EngineEvent,
  persistedDecision: SuggestionDecision,
  legacyAppointments: Appointment[],
  currentInstantMs?: number,
): Promise<OrbitalState> {
  const { state, runtimes, contexts, coordinatorOptions, legacyMeta, rejectedByGap } =
    await buildContextsFromDbInternal(currentInstantMs);
  const stateAfterEvent = applyEventToState(event, state);
  const filteredContexts = filterWaitlistByRejectedCandidates(
    contexts,
    rejectedByGap,
    extractGapEventId(event),
  );
  const decision = runCycle(
    event,
    stateAfterEvent,
    runtimes,
    filteredContexts,
    coordinatorOptions,
  );
  return cycleDecisionToOrbitalState(
    decision,
    event,
    runtimes,
    filteredContexts,
    legacyMeta,
    persistedDecision,
    legacyAppointments,
  );
}

// =============================================================================
// Helpers privados de traducción CycleDecision -> OrbitalState
// =============================================================================

function cycleDecisionToOrbitalState(
  decision: CycleDecision,
  event: EngineEvent,
  runtimes: AppointmentRuntimeMap,
  contexts: CoordinatorContexts,
  legacyMeta: LegacyMetadata,
  persistedDecision: SuggestionDecision,
  legacyAppointments: Appointment[],
): OrbitalState {
  if (decision.proposal === null || persistedDecision === "rejected") {
    return {
      appointments: legacyAppointments,
      suggestion: null,
      rankedCandidates: buildLegacyRankedCandidates(
        decision,
        contexts,
        legacyMeta,
      ),
      events: [],
      recommendationReason:
        persistedDecision === "rejected"
          ? "Sugerencia rechazada por el operador."
          : decision.proposal === null
            ? "El motor no encuentra una mejora suficientemente clara sobre el estado actual."
            : "",
      recoveredRevenue: 0,
      recoveredGaps: 0,
      decision: persistedDecision,
    };
  }

  const suggestion = buildLegacySuggestion(
    decision,
    event,
    runtimes,
    contexts,
    legacyMeta,
  );

  if (suggestion === null) {
    return {
      appointments: legacyAppointments,
      suggestion: null,
      rankedCandidates: buildLegacyRankedCandidates(
        decision,
        contexts,
        legacyMeta,
      ),
      events: [],
      recommendationReason:
        "El motor propone una acción que no es de tipo fill_from_waitlist (no soportado en la UI legacy todavía).",
      recoveredRevenue: 0,
      recoveredGaps: 0,
      decision: persistedDecision,
    };
  }

  const appointmentsWithSuggestion = buildLegacyAppointmentsView(
    legacyAppointments,
    suggestion,
    persistedDecision,
  );
  const recommendationReason = buildRecommendationReason(decision, suggestion);
  const rankedCandidates = buildLegacyRankedCandidates(
    decision,
    contexts,
    legacyMeta,
  );

  if (persistedDecision === "accepted") {
    return {
      appointments: appointmentsWithSuggestion,
      suggestion,
      rankedCandidates,
      events: [],
      recommendationReason,
      recoveredRevenue: suggestion.value,
      recoveredGaps: 1,
      decision: persistedDecision,
    };
  }

  return {
    appointments: appointmentsWithSuggestion,
    suggestion,
    rankedCandidates,
    events: [],
    recommendationReason,
    recoveredRevenue: 0,
    recoveredGaps: 0,
    decision: persistedDecision,
  };
}

function buildLegacySuggestion(
  decision: CycleDecision,
  event: EngineEvent,
  runtimes: AppointmentRuntimeMap,
  contexts: CoordinatorContexts,
  legacyMeta: LegacyMetadata,
): Suggestion | null {
  if (decision.proposal === null) return null;
  const fillPrimitive = decision.proposal.find(
    (p) => p.kind === "fill_from_waitlist",
  );
  if (fillPrimitive === undefined || fillPrimitive.kind !== "fill_from_waitlist") {
    return null;
  }

  const gapEventId = findCancelledEventIdForGap(event, runtimes, contexts);
  if (gapEventId === null) return null;
  const gapRuntime = runtimes[gapEventId];
  if (gapRuntime === undefined) return null;

  const startTime = formatStartTimeMadrid(gapRuntime.start);
  const gabineteName = legacyMeta.roomNameById[gapRuntime.roomId] ?? "—";

  const waitingCandidateId = fillPrimitive.waitingCandidateId;
  const patientName =
    legacyMeta.patientNameByWaitlistEntryId[waitingCandidateId] ?? "Paciente";
  const treatment =
    legacyMeta.waitlistTreatmentByEntryId[waitingCandidateId] ?? "Sin tratamiento";
  const durationSlots =
    legacyMeta.waitlistDurationSlotsByEntryId[waitingCandidateId] ??
    Math.max(1, Math.round(gapRuntime.plannedDuration / (30 * 60_000)));
  const value = legacyMeta.waitlistValueByEntryId[waitingCandidateId] ?? 0;

  return {
    start: startTime,
    gabinete: gabineteName,
    patient: patientName,
    type: treatment,
    durationSlots,
    status: "suggested",
    value,
    // S18.6: IDs opacos para que la UI pueda hacer reject_candidate sobre
    // este par específico (gap, candidato).
    gapEventId,
    waitingCandidateId,
  };
}

function findCancelledEventIdForGap(
  event: EngineEvent,
  runtimes: AppointmentRuntimeMap,
  contexts: CoordinatorContexts,
): EventId | null {
  if (event.kind === "cancellation") {
    return event.eventId;
  }
  void contexts;
  void runtimes;
  return null;
}

function buildLegacyAppointmentsView(
  legacyAppointments: Appointment[],
  suggestion: Suggestion,
  persistedDecision: SuggestionDecision,
): Appointment[] {
  const filtered = legacyAppointments.filter(
    (a) =>
      !(
        a.status === "cancelled" &&
        a.start === suggestion.start &&
        a.gabinete === suggestion.gabinete
      ),
  );
  // S18.5: cuando la sugerencia se ha aceptado, la cita inyectada pasa a
  // status "confirmed" para feedback visual inmediato (cambio de color en
  // agenda). Mejora deliberada respecto al v7.3, que mantenía "suggested"
  // tras Aceptar y no daba señal visual clara al usuario. Filosofía de
  // producto: lo visual es tan importante como lo funcional en este vertical.
  const visualStatus: AppointmentStatus =
    persistedDecision === "accepted" ? "confirmed" : "suggested";
  const suggestionAsAppointment: Appointment = {
    start: suggestion.start,
    gabinete: suggestion.gabinete,
    patient: suggestion.patient,
    type: suggestion.type,
    durationSlots: suggestion.durationSlots,
    status: visualStatus,
    value: suggestion.value,
  };
  return [...filtered, suggestionAsAppointment];
}

function buildLegacyRankedCandidates(
  decision: CycleDecision,
  contexts: CoordinatorContexts,
  legacyMeta: LegacyMetadata,
): RankedCandidate[] {
  const result: RankedCandidate[] = [];

  if (decision.proposal !== null) {
    const fillPrimitive = decision.proposal.find(
      (p) => p.kind === "fill_from_waitlist",
    );
    if (fillPrimitive !== undefined && fillPrimitive.kind === "fill_from_waitlist") {
      const wId = fillPrimitive.waitingCandidateId;
      const winner = waitlistEntryToRankedCandidate(
        wId,
        decision.explanation.projectedKPIs.projectedBillableValue,
        legacyMeta,
        translateMotiveCode(decision.explanation.motiveCode),
      );
      if (winner !== null) result.push(winner);
    }
  }

  for (const alt of decision.explanation.consideredAlternatives) {
    const fillPrim = alt.action.find((p) => p.kind === "fill_from_waitlist");
    if (fillPrim === undefined || fillPrim.kind !== "fill_from_waitlist") continue;
    const wId = fillPrim.waitingCandidateId;
    if (result.some((rc) => candidateMatchesWaitlistId(rc, wId, legacyMeta))) {
      continue;
    }
    const altCandidate = waitlistEntryToRankedCandidate(
      wId,
      alt.score,
      legacyMeta,
      translateDiscardReason(alt.discardReasonCode),
    );
    if (altCandidate !== null) result.push(altCandidate);
  }

  void contexts;

  return result;
}

function candidateMatchesWaitlistId(
  rc: RankedCandidate,
  waitlistEntryId: string,
  legacyMeta: LegacyMetadata,
): boolean {
  const expectedName = legacyMeta.patientNameByWaitlistEntryId[waitlistEntryId];
  return expectedName !== undefined && rc.name === expectedName;
}

function waitlistEntryToRankedCandidate(
  waitlistEntryId: string,
  totalScore: number,
  legacyMeta: LegacyMetadata,
  explanation: string,
): RankedCandidate | null {
  const name = legacyMeta.patientNameByWaitlistEntryId[waitlistEntryId];
  if (name === undefined) return null;
  const treatment =
    legacyMeta.waitlistTreatmentByEntryId[waitlistEntryId] ?? "Sin tratamiento";
  const durationSlots =
    legacyMeta.waitlistDurationSlotsByEntryId[waitlistEntryId] ?? 1;
  const value = legacyMeta.waitlistValueByEntryId[waitlistEntryId] ?? 0;

  return {
    name,
    treatment,
    durationSlots,
    value,
    totalScore,
    explanation,
    breakdown: {
      valueScore: 0,
      fitScore: 0,
      easeScore: 0,
      availabilityScore: 0,
      gabineteScore: 0,
      priorityScore: 0,
    },
  };
}

function translateMotiveCode(motiveCode: string): string {
  switch (motiveCode) {
    case "FILLS_GAP_WITH_VALUE":
      return "Rellena un hueco en agenda recuperando valor económico.";
    case "RECOVERS_BILLABLE_VALUE":
      return "Recupera valor facturable que se perdería.";
    case "REDUCES_OVERTIME":
      return "Reduce el riesgo de overtime al final de jornada.";
    case "REDUCES_PATIENT_WAIT":
      return "Reduce el tiempo de espera del paciente.";
    case "PROPAGATES_OVERRUN_MITIGATION":
      return "Mitiga la propagación de un retraso.";
    case "REASSIGNS_TO_AVAILABLE_RESOURCE":
      return "Reasigna a un recurso disponible.";
    case "RESPECTS_PROFESSIONAL_AVAILABILITY":
      return "Respeta la disponibilidad profesional.";
    case "BALANCES_DAY_LOAD":
      return "Equilibra la carga del día.";
    default:
      return "Mejora estimada sobre el estado actual.";
  }
}

function translateDiscardReason(discardCode: string | undefined): string {
  switch (discardCode) {
    case "WORSE_THAN_NO_OP":
      return "Peor que no actuar.";
    case "MARGINAL_IMPROVEMENT":
      return "Mejora marginal por debajo del umbral.";
    case "HIGH_VARIANCE":
      return "Alta varianza en KPIs proyectados.";
    case "HIGH_CHANGE_COST":
      return "Coste de cambio elevado.";
    case "DOMINATED_BY_ALTERNATIVE":
      return "Dominada por otra alternativa.";
    case "VALIDATION_FAILED":
      return "Falla validación de restricciones.";
    case "SIMULATION_FAILED":
      return "Falla la simulación.";
    default:
      return "Descartada.";
  }
}

function buildRecommendationReason(
  decision: CycleDecision,
  suggestion: Suggestion,
): string {
  const motiveText = translateMotiveCode(decision.explanation.motiveCode);
  return `${suggestion.patient}: ${motiveText}`;
}

function formatStartTimeMadrid(instantMs: InstantUTC): string {
  const fmt = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(new Date(instantMs));
}
