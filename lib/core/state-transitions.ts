/**
 * Transiciones de estado del DayState — Sesión 13 + 14.
 *
 * Aplica una CompositeAction al DayState y devuelve un nuevo DayState
 * hipotético (sin mutación). Función pura.
 *
 * Implementadas en v1: 9 primitivas
 *   - move:                   newStart + newResourceId (gabinete)
 *   - advance:                newStart
 *   - postpone:               newStart
 *   - compress:               estimatedEndDistribution comprimida
 *   - expand:                 estimatedEndDistribution expandida
 *   - reassign_professional:  appointment.professionalId
 *   - reassign_resource:      gabinete o equipo según resourceKind
 *   - no_op:                  sin cambios
 *   - fill_from_waitlist:     inserta nuevo AppointmentState/Runtime sintéticos
 *                             (Sesión 14: añadida; profesional asignado por
 *                             primer compatible — deuda GENERATOR-PROF-ASSIGN).
 *
 * Diferida a sesiones futuras:
 *   - cancel_and_reschedule:  cancela + reagenda. Lanza UnsupportedPrimitiveError.
 *
 * IMPORTANTE: este módulo NO valida coherencia operativa de las acciones.
 * Solo computa el estado resultante asumiendo que la acción es estructural-
 * mente coherente (validateCompositionCoherence ya pasó). La validación
 * contra restricciones es responsabilidad del Validator (validator.ts).
 *
 * Limitación documentada del modelo: AppointmentState (types.ts) no expone
 * directamente professionalId, roomId ni reservedEquipment. Mantenemos esa
 * información en una tabla auxiliar AppointmentRuntime que se pasa como
 * argumento, paralela a DayState.appointments. Cuando types.ts se extienda
 * (¿Sesión 18?) este shim desaparecerá.
 */

import type {
  DayState,
  AppointmentState,
  AdvanceAction,
  CompositeAction,
  CompressAction,
  ExpandAction,
  FillFromWaitlistAction,
  MoveAction,
  PostponeAction,
  PrimitiveAction,
  ReassignProfessionalAction,
  ReassignResourceAction,
  DurationDistribution,
  WaitingCandidate,
} from "./types";
import type { EventId, ResourceId, InstantUTC, DurationMs } from "./primitives";

// =============================================================================
// Tabla paralela: AppointmentRuntime
// =============================================================================

export interface AppointmentRuntime {
  readonly eventId: EventId;
  readonly professionalId: ResourceId;
  readonly roomId: ResourceId;
  readonly start: InstantUTC;
  readonly plannedDuration: DurationMs;
  readonly procedureId: ResourceId;
  readonly patientId: ResourceId;
  readonly reservedEquipment: ReadonlyArray<EquipmentReservationInfo>;
}

export interface EquipmentReservationInfo {
  readonly equipmentId: ResourceId;
  readonly fromMs: InstantUTC;
  readonly toMs: InstantUTC;
}

export type AppointmentRuntimeMap = Readonly<Record<EventId, AppointmentRuntime>>;

// =============================================================================
// Resultado y errores
// =============================================================================

export interface AppliedState {
  readonly state: DayState;
  readonly runtimes: AppointmentRuntimeMap;
}

export class UnsupportedPrimitiveError extends Error {
  constructor(public readonly kind: string) {
    super(`Primitive '${kind}' not supported in state-transitions v1.`);
    this.name = "UnsupportedPrimitiveError";
  }
}

export class UnknownEventError extends Error {
  constructor(public readonly eventId: EventId) {
    super(`Event '${eventId}' not found in DayState.`);
    this.name = "UnknownEventError";
  }
}

export class FillFromWaitlistMissingContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FillFromWaitlistMissingContextError";
  }
}

// =============================================================================
// Contexto opcional para fill_from_waitlist
// =============================================================================

/**
 * Información que el Generator/Coordinator debe pasar a applyComposite/applyPrimitive
 * cuando la composición incluye fill_from_waitlist.
 *
 * - waitingCandidates: para resolver waitingCandidateId → WaitingCandidate.
 * - resolveProfessional: callback que decide qué professionalId asignar al hueco
 *   (típicamente "primer compatible vía listCompatible"). El Generator lo
 *   inyecta; state-transitions no resuelve esto solo.
 * - estimatedEndDistribution: distribución de duración estimada del nuevo
 *   appointment (la habrá calculado C1 Predictor antes de proponer la candidata).
 *   Si no se proporciona, se construye una distribución degenerada
 *   (mean=stdDev=0, p10=p50=p90=proposedDuration). Documentado como simplificación v1.
 */
export interface FillFromWaitlistContext {
  readonly waitingCandidates: ReadonlyArray<WaitingCandidate>;
  readonly resolveProfessional: (
    candidate: WaitingCandidate,
    action: FillFromWaitlistAction,
  ) => ResourceId | null;
  readonly buildEstimatedDistribution?: (
    candidate: WaitingCandidate,
    action: FillFromWaitlistAction,
  ) => DurationDistribution;
}

export interface ApplyOptions {
  readonly fillFromWaitlist?: FillFromWaitlistContext;
}

// =============================================================================
// Helpers internos — mutaciones inmutables
// =============================================================================

function compressionFactor(
  oldDuration: DurationMs,
  newDuration: DurationMs,
): number {
  if (oldDuration <= 0) return 1;
  return newDuration / oldDuration;
}

function scaleDistribution(
  d: DurationDistribution,
  factor: number,
): DurationDistribution {
  return {
    mean: d.mean * factor,
    stdDev: d.stdDev * factor,
    p10: d.p10 * factor,
    p50: d.p50 * factor,
    p90: d.p90 * factor,
  };
}

function replaceAppointment(
  state: DayState,
  eventId: EventId,
  mutator: (a: AppointmentState) => AppointmentState,
): DayState {
  let found = false;
  const updated = state.appointments.map((a) => {
    if (a.eventId !== eventId) return a;
    found = true;
    return mutator(a);
  });
  if (!found) throw new UnknownEventError(eventId);
  return { ...state, appointments: updated };
}

function replaceRuntime(
  runtimes: AppointmentRuntimeMap,
  eventId: EventId,
  mutator: (r: AppointmentRuntime) => AppointmentRuntime,
): AppointmentRuntimeMap {
  const r = runtimes[eventId];
  if (r === undefined) throw new UnknownEventError(eventId);
  return { ...runtimes, [eventId]: mutator(r) };
}

function fallbackDistribution(duration: DurationMs): DurationDistribution {
  return {
    mean: duration,
    stdDev: 0,
    p10: duration,
    p50: duration,
    p90: duration,
  };
}

function syntheticEventId(waitingCandidateId: string): EventId {
  return `waitlist:${waitingCandidateId}`;
}

// =============================================================================
// Aplicación de primitivas individuales
// =============================================================================

function applyMove(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  action: MoveAction,
): AppliedState {
  const newRuntimes = replaceRuntime(runtimes, action.eventId, (r) => ({
    ...r,
    start: action.newStart,
    roomId: action.newResourceId,
  }));
  return { state, runtimes: newRuntimes };
}

function applyAdvance(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  action: AdvanceAction,
): AppliedState {
  const newRuntimes = replaceRuntime(runtimes, action.eventId, (r) => ({
    ...r,
    start: action.newStart,
  }));
  return { state, runtimes: newRuntimes };
}

function applyPostpone(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  action: PostponeAction,
): AppliedState {
  const newRuntimes = replaceRuntime(runtimes, action.eventId, (r) => ({
    ...r,
    start: action.newStart,
  }));
  return { state, runtimes: newRuntimes };
}

function applyCompress(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  action: CompressAction,
): AppliedState {
  const r = runtimes[action.eventId];
  if (r === undefined) throw new UnknownEventError(action.eventId);
  const factor = compressionFactor(r.plannedDuration, action.newDuration);

  const newState = replaceAppointment(state, action.eventId, (a) => ({
    ...a,
    estimatedEndDistribution: scaleDistribution(a.estimatedEndDistribution, factor),
  }));
  const newRuntimes = replaceRuntime(runtimes, action.eventId, (rt) => ({
    ...rt,
    plannedDuration: action.newDuration,
  }));
  return { state: newState, runtimes: newRuntimes };
}

function applyExpand(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  action: ExpandAction,
): AppliedState {
  const r = runtimes[action.eventId];
  if (r === undefined) throw new UnknownEventError(action.eventId);
  const factor = compressionFactor(r.plannedDuration, action.newDuration);

  const newState = replaceAppointment(state, action.eventId, (a) => ({
    ...a,
    estimatedEndDistribution: scaleDistribution(a.estimatedEndDistribution, factor),
  }));
  const newRuntimes = replaceRuntime(runtimes, action.eventId, (rt) => ({
    ...rt,
    plannedDuration: action.newDuration,
  }));
  return { state: newState, runtimes: newRuntimes };
}

function applyReassignProfessional(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  action: ReassignProfessionalAction,
): AppliedState {
  const newRuntimes = replaceRuntime(runtimes, action.eventId, (r) => ({
    ...r,
    professionalId: action.newProfessionalId,
  }));
  return { state, runtimes: newRuntimes };
}

function applyReassignResource(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  action: ReassignResourceAction,
): AppliedState {
  if (action.resourceKind === "room") {
    const newRuntimes = replaceRuntime(runtimes, action.eventId, (r) => ({
      ...r,
      roomId: action.newResourceId,
    }));
    return { state, runtimes: newRuntimes };
  }

  const r = runtimes[action.eventId];
  if (r === undefined) throw new UnknownEventError(action.eventId);
  if (r.reservedEquipment.length === 0) {
    const newRuntimes = replaceRuntime(runtimes, action.eventId, (rt) => ({
      ...rt,
      reservedEquipment: [
        {
          equipmentId: action.newResourceId,
          fromMs: rt.start,
          toMs: rt.start + rt.plannedDuration,
        },
      ],
    }));
    return { state, runtimes: newRuntimes };
  }

  const firstRange = r.reservedEquipment[0];
  const newRuntimes = replaceRuntime(runtimes, action.eventId, (rt) => ({
    ...rt,
    reservedEquipment: [
      {
        equipmentId: action.newResourceId,
        fromMs: firstRange.fromMs,
        toMs: firstRange.toMs,
      },
    ],
  }));
  return { state, runtimes: newRuntimes };
}

function applyFillFromWaitlist(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  action: FillFromWaitlistAction,
  options: ApplyOptions,
): AppliedState {
  const ctx = options.fillFromWaitlist;
  if (ctx === undefined) {
    throw new FillFromWaitlistMissingContextError(
      "fill_from_waitlist requires options.fillFromWaitlist context (waitingCandidates + resolveProfessional).",
    );
  }

  const candidate = ctx.waitingCandidates.find(
    (c) => c.id === action.waitingCandidateId,
  );
  if (candidate === undefined) {
    throw new FillFromWaitlistMissingContextError(
      `Waiting candidate '${action.waitingCandidateId}' not found in context.`,
    );
  }

  const professionalId = ctx.resolveProfessional(candidate, action);
  if (professionalId === null) {
    throw new FillFromWaitlistMissingContextError(
      `No compatible professional resolved for waiting candidate '${candidate.id}'.`,
    );
  }

  const eventId = syntheticEventId(candidate.id);
  if (runtimes[eventId] !== undefined) {
    throw new FillFromWaitlistMissingContextError(
      `Synthetic event '${eventId}' already exists; cannot fill twice from same candidate.`,
    );
  }

  // Necesitamos un procedureId para el runtime. Lo derivamos de
  // candidate.externalRefs.treatmentTypeId si existe; si no, un placeholder.
  // Esto refleja la convivencia TreatmentType / Procedure hasta Sesión 18.
  const procedureId =
    candidate.externalRefs?.treatmentTypeId ?? candidate.externalRefs?.procedureId ?? "unknown";
  const patientId = candidate.externalRefs?.patientId ?? candidate.id;

  const estimatedEndDistribution =
    ctx.buildEstimatedDistribution?.(candidate, action) ??
    fallbackDistribution(action.proposedDuration);

  const newAppointment: AppointmentState = {
    eventId,
    runtimeStatus: "scheduled",
    estimatedEndDistribution,
    detectedRisks: {
      overrunProbability: 0,
      noShowProbability: 0,
      significantLatenessProbability: 0,
    },
  };

  const newRuntime: AppointmentRuntime = {
    eventId,
    professionalId,
    roomId: action.gapResourceId,
    start: action.gapStart,
    plannedDuration: action.proposedDuration,
    procedureId,
    patientId,
    reservedEquipment: [],
  };

  return {
    state: {
      ...state,
      appointments: [...state.appointments, newAppointment],
    },
    runtimes: { ...runtimes, [eventId]: newRuntime },
  };
}

// =============================================================================
// API pública
// =============================================================================

export function applyPrimitive(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  action: PrimitiveAction,
  options: ApplyOptions = {},
): AppliedState {
  switch (action.kind) {
    case "no_op":
      return { state, runtimes };
    case "move":
      return applyMove(state, runtimes, action);
    case "advance":
      return applyAdvance(state, runtimes, action);
    case "postpone":
      return applyPostpone(state, runtimes, action);
    case "compress":
      return applyCompress(state, runtimes, action);
    case "expand":
      return applyExpand(state, runtimes, action);
    case "reassign_professional":
      return applyReassignProfessional(state, runtimes, action);
    case "reassign_resource":
      return applyReassignResource(state, runtimes, action);
    case "fill_from_waitlist":
      return applyFillFromWaitlist(state, runtimes, action, options);
    case "cancel_and_reschedule":
      throw new UnsupportedPrimitiveError("cancel_and_reschedule");
  }
}

export function applyComposite(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  action: CompositeAction,
  options: ApplyOptions = {},
): AppliedState {
  let current: AppliedState = { state, runtimes };
  for (const prim of action) {
    current = applyPrimitive(current.state, current.runtimes, prim, options);
  }
  return current;
}