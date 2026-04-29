/**
 * Validator (C2) — Sesión 13.
 *
 * Segundo componente vivo del clean core. Implementa las 2 APIs del
 * Componente 2 según core-contract.md §6 y logica-reoptimizacion-saas.md §10:
 *
 *   validate(state, action, context)        → ValidationResult
 *   listCompatible(appointment, kind, ctx)  → ReadonlyArray<ResourceId>
 *
 * Política de Sesión 13 (master §6 + decisión D3): SIN reglas configurables
 * de ConstraintRule — solo las 4 universales operativas:
 *   - PHYSICAL:                solapes de gabinete y profesional (un recurso
 *                              no puede estar en dos sitios a la vez).
 *   - PROFESSIONAL_HOURS:      cita dentro del workSchedule del dentista.
 *   - RESOURCE_AVAILABILITY:   conflictos de equipamiento entre citas.
 *   - CHAINING:                precondición clínica satisfecha en el
 *                              historial del paciente.
 *
 * Diferidas: CLINICAL_SAFETY, LEGAL_REGULATORY, PROFESSIONAL_BREAK, los 3
 * PATIENT_*, INFORMATION_DEPENDENCY, ECONOMIC_DEPENDENCY. Se implementarán
 * cuando los datos necesarios estén modelados (ver decisiones D3 sesión 13).
 *
 * Función pura. No accede a Prisma. Recibe DayState + runtimes (capa
 * paralela definida en state-transitions.ts) + descriptores de recursos
 * (domain-types.ts). La capa adapter (Sesión 17) cargará todo desde DB.
 */

import type {
  DayState,
  CompositeAction,
  ConstraintViolation,
  ValidationResult,
  AppointmentState,
} from "./types";
import type { ResourceId, ScoreRatio, EventId, InstantUTC } from "./primitives";
import {
  applyComposite,
  type AppointmentRuntime,
  type AppointmentRuntimeMap,
} from "./state-transitions";
import {
  instantToDayAndMinutes,
  parseHHMM,
  type EquipmentInfo,
  type PatientHistory,
  type ProcedureRequirements,
  type ProfessionalCapabilities,
  type RoomCapabilities,
  type WorkSchedule,
} from "./domain-types";

// =============================================================================
// Contexto de validación
// =============================================================================

/**
 * Contexto necesario para validar. Contiene los datos del catálogo y de la
 * configuración del tenant que el Validator consulta. Lo construye el adapter.
 *
 * El argumento `runtimes` debe corresponder al MISMO instante que `state`:
 * uno y otro se mantienen sincronizados por el adapter.
 */
export interface ValidationContext {
  readonly runtimes: AppointmentRuntimeMap;
  readonly professionals: ReadonlyArray<ProfessionalCapabilities>;
  readonly rooms: ReadonlyArray<RoomCapabilities>;
  readonly equipment: ReadonlyArray<EquipmentInfo>;
  readonly proceduresById: Readonly<Record<ResourceId, ProcedureRequirements>>;
  readonly patientHistoryById: Readonly<Record<ResourceId, PatientHistory>>;
}

// =============================================================================
// Constantes
// =============================================================================

const SOFT_DEFAULT_COST: ScoreRatio = 0.5;

// =============================================================================
// Helpers — rangos temporales
// =============================================================================

interface TimeInterval {
  readonly start: InstantUTC;
  readonly end: InstantUTC;
}

function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  return a.start < b.end && b.start < a.end;
}

function runtimeInterval(r: AppointmentRuntime): TimeInterval {
  return { start: r.start, end: r.start + r.plannedDuration };
}

function findProfessional(
  professionals: ReadonlyArray<ProfessionalCapabilities>,
  professionalId: ResourceId,
): ProfessionalCapabilities | undefined {
  return professionals.find((p) => p.professionalId === professionalId);
}

function findEquipment(
  equipment: ReadonlyArray<EquipmentInfo>,
  equipmentId: ResourceId,
): EquipmentInfo | undefined {
  return equipment.find((e) => e.equipmentId === equipmentId);
}

function isAppointmentLive(a: AppointmentState): boolean {
  return a.runtimeStatus !== "cancelled" && a.runtimeStatus !== "no_show";
}

// =============================================================================
// Reglas universales — cada una devuelve un array de ConstraintViolation
// =============================================================================

/**
 * PHYSICAL: dos appointments no pueden compartir room ni professional
 * en intervalos solapados. Genera una violation hard por cada par en conflicto.
 */
function checkPhysical(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
): ReadonlyArray<ConstraintViolation> {
  const violations: ConstraintViolation[] = [];
  const live = state.appointments.filter(isAppointmentLive);
  const liveIds = new Set(live.map((a) => a.eventId));

  const ids = Object.keys(runtimes).filter((id) => liveIds.has(id));

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = runtimes[ids[i]];
      const b = runtimes[ids[j]];
      if (!intervalsOverlap(runtimeInterval(a), runtimeInterval(b))) continue;

      // Solape de room
      if (a.roomId === b.roomId) {
        violations.push({
          code: "PHYSICAL",
          hardness: "hard",
          cost: 0,
          affectedEventIds: [a.eventId, b.eventId],
          affectedResourceIds: [a.roomId],
        });
      }
      // Solape de profesional
      if (a.professionalId === b.professionalId) {
        violations.push({
          code: "PHYSICAL",
          hardness: "hard",
          cost: 0,
          affectedEventIds: [a.eventId, b.eventId],
          affectedResourceIds: [a.professionalId],
        });
      }
    }
  }

  return violations;
}

/**
 * PROFESSIONAL_HOURS: cada appointment vivo debe estar dentro del workSchedule
 * del profesional asignado. Si no hay workSchedule documentado para ese
 * profesional, no se valida (sin información, no se viola — limitación v1).
 *
 * Considera mañana O tarde del día correspondiente. La cita debe caber
 * COMPLETA en alguno de los dos tramos (no se permite mitad mañana / mitad tarde).
 */
function checkProfessionalHours(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  professionals: ReadonlyArray<ProfessionalCapabilities>,
): ReadonlyArray<ConstraintViolation> {
  const violations: ConstraintViolation[] = [];
  const live = state.appointments.filter(isAppointmentLive);

  for (const apt of live) {
    const r = runtimes[apt.eventId];
    if (r === undefined) continue;
    const prof = findProfessional(professionals, r.professionalId);
    if (prof === undefined || prof.workSchedule === null) continue;

    const interval = runtimeInterval(r);
    if (!fitsInWorkSchedule(interval, prof.workSchedule)) {
      violations.push({
        code: "PROFESSIONAL_HOURS",
        hardness: "hard",
        cost: 0,
        affectedEventIds: [apt.eventId],
        affectedResourceIds: [r.professionalId],
      });
    }
  }

  return violations;
}

function fitsInWorkSchedule(
  interval: TimeInterval,
  schedule: WorkSchedule,
): boolean {
  const startInfo = instantToDayAndMinutes(interval.start);
  const endInfo = instantToDayAndMinutes(interval.end);

  // Cita que cruza medianoche UTC: rechazada por simplicidad v1 (no existe
  // operativamente en clínica dental real; defendible).
  if (startInfo.dayOfWeek !== endInfo.dayOfWeek) return false;

  const day = schedule[String(startInfo.dayOfWeek)];
  if (day === undefined) return false;

  const startMin = startInfo.minutesOfDay;
  const endMin = endInfo.minutesOfDay;

  // Mañana
  if (day.morningOpen !== undefined && day.morningClose !== undefined) {
    const open = parseHHMM(day.morningOpen);
    const close = parseHHMM(day.morningClose);
    if (open !== null && close !== null && startMin >= open && endMin <= close) {
      return true;
    }
  }
  // Tarde
  if (day.afternoonOpen !== undefined && day.afternoonClose !== undefined) {
    const open = parseHHMM(day.afternoonOpen);
    const close = parseHHMM(day.afternoonClose);
    if (open !== null && close !== null && startMin >= open && endMin <= close) {
      return true;
    }
  }
  return false;
}

/**
 * RESOURCE_AVAILABILITY: dos reservas del mismo equipamiento en intervalos
 * solapados generan conflicto. Detecta cualquier solape entre EquipmentReservationInfo
 * de distintos appointments vivos.
 */
function checkResourceAvailability(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
): ReadonlyArray<ConstraintViolation> {
  const violations: ConstraintViolation[] = [];
  const live = state.appointments.filter(isAppointmentLive);
  const liveIds = new Set(live.map((a) => a.eventId));

  // Aplanar todas las reservas con su eventId.
  interface FlatReservation {
    readonly eventId: EventId;
    readonly equipmentId: ResourceId;
    readonly fromMs: InstantUTC;
    readonly toMs: InstantUTC;
  }
  const reservations: FlatReservation[] = [];
  for (const eventId of Object.keys(runtimes)) {
    if (!liveIds.has(eventId)) continue;
    for (const res of runtimes[eventId].reservedEquipment) {
      reservations.push({
        eventId,
        equipmentId: res.equipmentId,
        fromMs: res.fromMs,
        toMs: res.toMs,
      });
    }
  }

  for (let i = 0; i < reservations.length; i++) {
    for (let j = i + 1; j < reservations.length; j++) {
      const a = reservations[i];
      const b = reservations[j];
      if (a.equipmentId !== b.equipmentId) continue;
      if (a.eventId === b.eventId) continue;
      if (!intervalsOverlap(
        { start: a.fromMs, end: a.toMs },
        { start: b.fromMs, end: b.toMs },
      )) continue;
      violations.push({
        code: "RESOURCE_AVAILABILITY",
        hardness: "hard",
        cost: 0,
        affectedEventIds: [a.eventId, b.eventId],
        affectedResourceIds: [a.equipmentId],
      });
    }
  }

  return violations;
}

/**
 * CHAINING: si el procedimiento de un appointment requiere una precondición
 * clínica (Procedure.clinicalDependencies.precondition), debe existir una
 * entrada en patientHistory con ese procedureCode completada antes del
 * inicio de la cita actual.
 *
 * Si el procedimiento no requiere precondición → no aplica (no genera violación).
 * Si no hay procedureRequirements para el procedimiento referenciado en el
 * runtime → tampoco se valida (limitación v1, debería logearse como warning
 * por la capa adapter).
 */
function checkChaining(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  proceduresById: Readonly<Record<ResourceId, ProcedureRequirements>>,
  patientHistoryById: Readonly<Record<ResourceId, PatientHistory>>,
): ReadonlyArray<ConstraintViolation> {
  const violations: ConstraintViolation[] = [];
  const live = state.appointments.filter(isAppointmentLive);

  for (const apt of live) {
    const r = runtimes[apt.eventId];
    if (r === undefined) continue;
    const reqs = proceduresById[r.procedureId];
    if (reqs === undefined || reqs.precondition === null) continue;

    const requiredCode = reqs.precondition.requiredProcedureCode;
    const history = patientHistoryById[r.patientId];
    const satisfied =
      history !== undefined &&
      history.completedProcedures.some(
        (h) => h.procedureCode === requiredCode && h.completedAt < r.start,
      );

    if (!satisfied) {
      violations.push({
        code: "CHAINING",
        hardness: "hard",
        cost: 0,
        affectedEventIds: [apt.eventId],
        affectedResourceIds: [r.patientId],
      });
    }
  }

  return violations;
}

// =============================================================================
// API pública — validate
// =============================================================================

/**
 * Valida una CompositeAction aplicada al estado contra las restricciones
 * universales del sistema.
 *
 * Pasos:
 *  1. Aplica la acción al estado (state-transitions.applyComposite).
 *  2. Ejecuta las 4 reglas universales sobre el estado resultante.
 *  3. Agrupa hard / soft violations.
 *
 * Si la acción incluye una primitiva no soportada (fill_from_waitlist,
 * cancel_and_reschedule), la excepción de applyComposite se propaga: el
 * llamante (Generator) debe asegurarse de no producir composiciones con ellas
 * hasta Sesión 14+.
 */
export function validate(
  state: DayState,
  action: CompositeAction,
  context: ValidationContext,
): ValidationResult {
  const applied = applyComposite(state, context.runtimes, action);

  const physical = checkPhysical(applied.state, applied.runtimes);
  const professionalHours = checkProfessionalHours(
    applied.state,
    applied.runtimes,
    context.professionals,
  );
  const resourceAvailability = checkResourceAvailability(
    applied.state,
    applied.runtimes,
  );
  const chaining = checkChaining(
    applied.state,
    applied.runtimes,
    context.proceduresById,
    context.patientHistoryById,
  );

  const all: ConstraintViolation[] = [
    ...physical,
    ...professionalHours,
    ...resourceAvailability,
    ...chaining,
  ];

  const hardViolations = all.filter((v) => v.hardness === "hard");
  const softViolations = all.filter((v) => v.hardness === "soft");

  return {
    valid: hardViolations.length === 0,
    hardViolations,
    softViolations,
  };
}

// =============================================================================
// API pública — listCompatible
// =============================================================================

/**
 * Lista de recursos del kind solicitado que son compatibles con un appointment.
 *
 * Compatibilidad por kind:
 *  - "professional": el profesional tiene TODAS las capacidades requeridas por
 *    el procedimiento (capability > 0 en su map para cada requisito).
 *  - "room": la sala tiene TODAS las capacidades requeridas (derivedCapabilities
 *    incluye cada requisito como true).
 *  - "equipment": equipos cuyo equipmentType coincide con alguno de los
 *    requeridos por el procedimiento.
 *
 * No considera disponibilidad temporal (eso lo cubre validate sobre la
 * acción concreta). Solo compatibilidad estructural.
 */
export function listCompatible(
  appointment: AppointmentState,
  procedureId: ResourceId,
  kind: "professional" | "room" | "equipment",
  context: ValidationContext,
): ReadonlyArray<ResourceId> {
  const reqs = context.proceduresById[procedureId];
  if (reqs === undefined) return [];

  // Silenciar warning de "appointment unused": en v1 listCompatible no consulta
  // el estado de la cita más allá de su procedureId, pero la firma queda
  // preparada para v2 (donde podría considerar paciente/historial).
  void appointment;

  switch (kind) {
    case "professional":
      return context.professionals
        .filter((p) =>
          reqs.requiresProfessionalCapabilities.every(
            (cap) => (p.capabilities[cap] ?? 0) > 0,
          ),
        )
        .map((p) => p.professionalId);

    case "room":
      return context.rooms
        .filter((r) =>
          reqs.requiresRoomCapabilities.every(
            (cap) => r.derivedCapabilities[cap] === true,
          ),
        )
        .map((r) => r.roomId);

    case "equipment": {
      const requiredTypes = new Set(
        reqs.requiresEquipment.map((e) => e.equipmentType),
      );
      return context.equipment
        .filter((e) => requiredTypes.has(e.equipmentType))
        .map((e) => e.equipmentId);
    }
  }
}

/** Re-export del tipo del cost de soft para consumo de tests. */
export const VALIDATOR_SOFT_DEFAULT_COST = SOFT_DEFAULT_COST;