/**
 * Tipos del dominio compartidos por componentes del motor — Sesión 13.
 *
 * A diferencia de:
 *  - types.ts: tipos del modelo mental (DayState, Action, Constraint, etc.).
 *  - predictor-types.ts: inputs específicos del Predictor (C1).
 *
 * Este módulo contiene estructuras de configuración del tenant y descriptores
 * de recursos que múltiples componentes (Validator, Generator, Simulator)
 * necesitan consumir. Vienen del schema Prisma (Dentist, Gabinete, Equipment,
 * Procedure) parseados en formas tipadas.
 *
 * La capa adapter (Sesión 17) cargará desde DB y construirá estos tipos.
 */

import type { ResourceId, InstantUTC, DurationMs } from "./primitives";

// =============================================================================
// 1. Calendario laboral del profesional
// =============================================================================

/**
 * Estructura de un día laboral. Coincide con DaySchedule de la clínica
 * pero a nivel profesional (cada dentista puede tener el suyo).
 *
 * Strings en formato "HH:MM" (24h). Si morningOpen/Close están definidos
 * pero afternoon* no, el profesional solo trabaja por la mañana, etc.
 *
 * Si todas son undefined → el profesional NO trabaja ese día.
 */
export interface WorkScheduleDay {
  readonly morningOpen?: string;
  readonly morningClose?: string;
  readonly afternoonOpen?: string;
  readonly afternoonClose?: string;
}

/**
 * Calendario laboral de un profesional. Clave: dayOfWeek como string "0"-"6"
 * donde 0=domingo, 1=lunes, …, 6=sábado (convención JavaScript Date.getDay()).
 *
 * Días no presentes en el record → el profesional NO trabaja ese día.
 */
export type WorkSchedule = Readonly<Record<string, WorkScheduleDay>>;

// =============================================================================
// 2. Capacidades de profesional, sala, equipamiento
// =============================================================================

/**
 * Vector de capacidades de un profesional sobre el catálogo de capacidades
 * del sistema. Valores en [0, 1] indicando nivel de dominio:
 *   1.0 = competencia plena
 *   0.5 = puede hacer pero con supervisión / casos básicos
 *   0.0 = no documentado / no puede
 *
 * Refleja el campo Dentist.capabilities Json. Las claves son strings opacos
 * tipo "general_dentistry", "endodontics", "implantology", etc., consistentes
 * con Procedure.requiresProfessionalCapabilities.
 */
export type ProfessionalCapabilityMap = Readonly<Record<string, number>>;

export interface ProfessionalCapabilities {
  readonly professionalId: ResourceId;
  readonly capabilities: ProfessionalCapabilityMap;
  readonly workSchedule: WorkSchedule | null;
  /** Coste por hora del profesional (para Scorer C5). Null si no documentado. */
  readonly hourlyCost: number | null;
}

/**
 * Capacidades de una sala derivadas de su equipamiento fijo.
 *
 * Política Sesión 11C: NO se persiste — se calcula en runtime a partir
 * del Equipment con modality="fixed_in_room" asignado al gabinete vía
 * EquipmentRoom. La capa adapter computa este map.
 */
export type RoomCapabilityMap = Readonly<Record<string, boolean>>;

export interface RoomCapabilities {
  readonly roomId: ResourceId;
  readonly derivedCapabilities: RoomCapabilityMap;
}

/**
 * Información estática de un equipo. Refleja una fila de la tabla Equipment
 * (campos relevantes para el Validator).
 */
export interface EquipmentInfo {
  readonly equipmentId: ResourceId;
  /** Tipo del equipo, ej. "intraoral_scanner". Coincide con keys de Procedure.requiresEquipment. */
  readonly equipmentType: string;
  /** "fixed_in_room" | "mobile". */
  readonly modality: string;
  /** IDs de gabinetes compatibles (de la tabla EquipmentRoom). */
  readonly compatibleRoomIds: ReadonlyArray<ResourceId>;
}

// =============================================================================
// 3. Requerimientos de un procedimiento
// =============================================================================

/**
 * Una entrada de Procedure.requiresEquipment[]. Tipo + duración de uso.
 */
export interface ProcedureEquipmentRequirement {
  readonly equipmentType: string;
  readonly durationMinutes: number;
}

/**
 * Una precondición clínica simple: este procedimiento requiere que el paciente
 * tenga un procedimiento previo completado con cierto code.
 *
 * v1: solo soporta { precondition: string } parseable de Procedure.clinicalDependencies.
 * v2 podría tipar más complejidades (intervalos, post-procedimientos, etc.).
 */
export interface ClinicalPrecondition {
  readonly requiredProcedureCode: string;
}

/**
 * Requerimientos de un procedimiento del catálogo, parseados en formas tipadas.
 * Refleja los campos Json de la tabla Procedure.
 */
export interface ProcedureRequirements {
  readonly procedureId: ResourceId;
  readonly procedureCode: string;
  readonly requiresProfessionalCapabilities: ReadonlyArray<string>;
  readonly requiresRoomCapabilities: ReadonlyArray<string>;
  readonly requiresEquipment: ReadonlyArray<ProcedureEquipmentRequirement>;
  readonly requiresAuxiliary: boolean;
  readonly precondition: ClinicalPrecondition | null;
}

// =============================================================================
// 4. Historial mínimo del paciente (para validar CHAINING)
// =============================================================================

/**
 * Resumen mínimo del historial del paciente: qué procedimientos completó
 * y cuándo. Usado por el Validator para CHAINING (precondiciones clínicas).
 *
 * "Completado" = appointment con status="completed" y actualEndTime != null.
 */
export interface PatientHistoryEntry {
  readonly procedureCode: string;
  readonly completedAt: InstantUTC;
}

export interface PatientHistory {
  readonly patientId: ResourceId;
  readonly completedProcedures: ReadonlyArray<PatientHistoryEntry>;
}

// =============================================================================
// 5. Helpers públicos para parseo de horas HH:MM
// =============================================================================

/**
 * Convierte "HH:MM" a minutos desde medianoche. Devuelve null si malformado.
 * Ej: "09:30" → 570. "14:00" → 840.
 */
export function parseHHMM(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

/**
 * Helper auxiliar para Validator: convierte un InstantUTC a (dayOfWeek, minutesOfDay)
 * en UTC. Las clínicas operan en zona horaria del tenant, pero el clean core es
 * UTC interno. La capa adapter aplicará la conversión de TZ antes de pasar
 * el InstantUTC al Validator si la regla `PROFESSIONAL_HOURS` debe interpretarse
 * en hora local — por ahora asumimos que workSchedule está expresado en la TZ
 * en la que viene el InstantUTC (UTC).
 *
 * Limitación reconocida: cuando se cierre TZ-MADRID-VERCEL (Sesión 18), esto
 * pasará por el conversor de TZ del adapter.
 */
export interface DayOfWeekAndMinutes {
  readonly dayOfWeek: number;
  readonly minutesOfDay: number;
}

export function instantToDayAndMinutes(instant: InstantUTC): DayOfWeekAndMinutes {
  const d = new Date(instant);
  return {
    dayOfWeek: d.getUTCDay(),
    minutesOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

/** Re-export semántico de tipos del clean core que estos helpers manejan. */
export type { DurationMs, InstantUTC, ResourceId };