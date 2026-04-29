/**
 * Transiciones de estado del DayState — Sesión 13.
 *
 * Aplica una CompositeAction al DayState y devuelve un nuevo DayState
 * hipotético (sin mutación). Función pura.
 *
 * Implementadas en v1: 8 primitivas estructurales que mutan campos del
 * AppointmentState afectado:
 *   - move:                  newStart + newResourceId (gabinete)
 *   - advance:               newStart
 *   - postpone:              newStart
 *   - compress:              estimatedEndDistribution comprimida
 *   - expand:                estimatedEndDistribution expandida
 *   - reassign_professional: appointment.professionalId
 *   - reassign_resource:     gabinete o equipo según resourceKind
 *   - no_op:                 sin cambios
 *
 * Diferidas a Sesión 14 (Generator) o Sesión 15 (Simulator):
 *   - fill_from_waitlist:    requiere construir AppointmentState completo
 *                            desde un WaitingCandidate.
 *   - cancel_and_reschedule: cancela + reagenda.
 *
 * Estas dos lanzan Error si aparecen en una composición — el Validator las
 * rechazará con un test específico hasta que se implementen.
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
 * (¿Sesión 18?) este shim desaparecerá. Decisión registrada en core-contract
 * pendiente de actualizar en cierre de jornada.
 */

import type {
  DayState,
  AppointmentState,
  AdvanceAction,
  CompositeAction,
  CompressAction,
  ExpandAction,
  MoveAction,
  PostponeAction,
  PrimitiveAction,
  ReassignProfessionalAction,
  ReassignResourceAction,
  DurationDistribution,
} from "./types";
import type { EventId, ResourceId, InstantUTC, DurationMs } from "./primitives";

// =============================================================================
// Tabla paralela: AppointmentRuntime
// =============================================================================

/**
 * Información operativa de un appointment que NO está expuesta en
 * AppointmentState (types.ts del modelo mental). El Validator y el Simulator
 * la necesitan para razonar sobre asignaciones de recursos.
 *
 * Convención: para todo eventId presente en DayState.appointments, debe
 * existir UNA y solo UNA entrada AppointmentRuntime con ese mismo eventId.
 * El adapter (Sesión 17) garantizará esta correspondencia.
 *
 * Se mantiene como tabla paralela en lugar de extender AppointmentState
 * para no tocar tipos del modelo mental en Sesión 13.
 */
export interface AppointmentRuntime {
  readonly eventId: EventId;
  readonly professionalId: ResourceId;
  readonly roomId: ResourceId;
  readonly start: InstantUTC;
  readonly plannedDuration: DurationMs;
  readonly procedureId: ResourceId;
  readonly patientId: ResourceId;
  /** Equipos reservados (de la tabla AppointmentEquipment). */
  readonly reservedEquipment: ReadonlyArray<EquipmentReservationInfo>;
}

export interface EquipmentReservationInfo {
  readonly equipmentId: ResourceId;
  readonly fromMs: InstantUTC;
  readonly toMs: InstantUTC;
}

/** Mapa eventId → AppointmentRuntime. Lo construye el adapter. */
export type AppointmentRuntimeMap = Readonly<Record<EventId, AppointmentRuntime>>;

// =============================================================================
// Resultado de aplicar una CompositeAction
// =============================================================================

export interface AppliedState {
  readonly state: DayState;
  readonly runtimes: AppointmentRuntimeMap;
}

/**
 * Error lanzado cuando la composición incluye una primitiva no soportada
 * en v1 (fill_from_waitlist, cancel_and_reschedule). Identificable por nombre.
 */
export class UnsupportedPrimitiveError extends Error {
  constructor(public readonly kind: string) {
    super(`Primitive '${kind}' not supported in state-transitions v1.`);
    this.name = "UnsupportedPrimitiveError";
  }
}

/**
 * Error lanzado cuando una primitiva referencia un eventId inexistente
 * en DayState.appointments / runtimes.
 */
export class UnknownEventError extends Error {
  constructor(public readonly eventId: EventId) {
    super(`Event '${eventId}' not found in DayState.`);
    this.name = "UnknownEventError";
  }
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

// =============================================================================
// Aplicación de primitivas individuales
// =============================================================================

function applyMove(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  action: MoveAction,
): AppliedState {
  // En v1, MoveAction.newResourceId se interpreta como nuevo gabinete (room).
  // Convención del documento de lógica §3 capa 4. Si en futuro se necesita
  // mover a otro profesional simultáneamente, usar reassign_professional.
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

  // resourceKind === "equipment": reemplaza TODA la lista de equipos reservados
  // por una sola reserva del nuevo equipo, manteniendo el rango temporal
  // del primero (asunción simplificadora v1: típicamente las reservas son sobre
  // el mismo rango). El Generator (Sesión 14) puede producir composiciones más
  // sofisticadas si necesita varios equipos.
  const r = runtimes[action.eventId];
  if (r === undefined) throw new UnknownEventError(action.eventId);
  if (r.reservedEquipment.length === 0) {
    // No había equipo previo: añadir uno con rango = [start, start + plannedDuration)
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

// =============================================================================
// API pública
// =============================================================================

/**
 * Aplica una primitiva al estado. Función pura.
 *
 * @throws UnsupportedPrimitiveError si la primitiva no está implementada en v1.
 * @throws UnknownEventError si la primitiva referencia un eventId inexistente.
 */
export function applyPrimitive(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  action: PrimitiveAction,
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
      throw new UnsupportedPrimitiveError("fill_from_waitlist");
    case "cancel_and_reschedule":
      throw new UnsupportedPrimitiveError("cancel_and_reschedule");
  }
}

/**
 * Aplica una CompositeAction (secuencia de primitivas) al estado, en orden.
 *
 * Asume que la composición es estructuralmente coherente
 * (validateCompositionCoherence ya pasó en quien construye la composición —
 * típicamente el Generator C3). NO se valida aquí.
 *
 * @throws UnsupportedPrimitiveError si alguna primitiva no está soportada en v1.
 * @throws UnknownEventError si alguna primitiva referencia un eventId inexistente.
 */
export function applyComposite(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  action: CompositeAction,
): AppliedState {
  let current: AppliedState = { state, runtimes };
  for (const prim of action) {
    current = applyPrimitive(current.state, current.runtimes, prim);
  }
  return current;
}