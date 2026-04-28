import type {
  ResourceId,
  EventId,
  CandidateId,
  InstantUTC,
  DurationMs,
  MonetaryAmount,
  ScoreRatio,
} from "./primitives";

// =============================================================================
// SESIÓN 9 v1.0 — Tipos del clean core agnóstico (NO MODIFICAR)
//
// Estos tipos son la base del clean core implementado en Sesión 9 v1.0.
// Los componentes del motor (Sesiones 12-17) los CONSUMEN y los EXTIENDEN
// con los tipos del modelo mental añadidos abajo, pero no los redefinen.
// =============================================================================

export type EventStatus = "confirmed" | "delayed" | "cancelled" | "suggested";

export type DecisionState = "pending" | "accepted" | "rejected";

/**
 * Códigos de explicación que el motor v1.0 devuelve para cada candidato
 * puntuado. Traducción a lenguaje humano vive en ui/i18n/{locale}.json.
 *
 * Nota Sesión 10: en v2.0 del contrato se documenta que estos códigos son
 * los del Componente 5 (Puntuador) en su forma sin simulación. Los códigos
 * del modelo mental completo (motivos de explicación, motivos de descarte
 * de alternativas) son ExplanationMotiveCode y DiscardReasonCode más abajo.
 */
export type ExplanationCode =
  | "FIT_EXACT"
  | "FIT_NEAR"
  | "FIT_LOOSE"
  | "RESOURCE_MATCH"
  | "RESOURCE_MISMATCH"
  | "RESOURCE_NEUTRAL"
  | "AVAILABILITY_HIGH"
  | "AVAILABILITY_LOW"
  | "VALUE_HIGH"
  | "VALUE_MEDIUM"
  | "VALUE_LOW"
  | "PRIORITY_HIGH"
  | "EASE_HIGH"
  | "EASE_LOW";

/** Bolsa opaca de metadata externa. El core nunca inspecciona esto. */
export type ExternalRefs = Readonly<Record<string, string>>;

export interface ScheduledEvent {
  readonly id: EventId;
  readonly resourceId: ResourceId;
  readonly start: InstantUTC;
  readonly duration: DurationMs;
  readonly status: EventStatus;
  readonly value?: MonetaryAmount;
  readonly externalRefs?: ExternalRefs;
}

export interface WaitingCandidate {
  readonly id: CandidateId;
  readonly preferredResourceId?: ResourceId;
  readonly desiredDuration: DurationMs;
  readonly value: MonetaryAmount;
  readonly priority: ScoreRatio;
  readonly easeScore: ScoreRatio;
  readonly availableNow: boolean;
  readonly externalRefs?: ExternalRefs;
}

export interface Gap {
  readonly resourceId: ResourceId;
  readonly start: InstantUTC;
  readonly duration: DurationMs;
  readonly originEventId: EventId;
}

export interface ScoreBreakdown {
  readonly value: ScoreRatio;
  readonly fit: ScoreRatio;
  readonly ease: ScoreRatio;
  readonly availability: ScoreRatio;
  readonly resource: ScoreRatio;
  readonly priority: ScoreRatio;
}

export interface RankedCandidate {
  readonly candidateId: CandidateId;
  readonly totalScore: ScoreRatio;
  readonly breakdown: ScoreBreakdown;
  readonly explanationCodes: ReadonlyArray<ExplanationCode>;
}

export interface Suggestion {
  readonly gap: Gap;
  readonly recommended: RankedCandidate;
  readonly alternatives: ReadonlyArray<RankedCandidate>;
}

export interface EngineResult {
  readonly suggestions: ReadonlyArray<Suggestion>;
  readonly recoveredValue: MonetaryAmount;
  readonly recoveredGaps: number;
  readonly decision: DecisionState;
}

// =============================================================================
// SESIÓN 10 — Tipos del modelo mental del motor (logica-reoptimizacion-saas.md)
//
// Los siguientes bloques implementan los tipos descritos en §9, §10 y §11 del
// documento de lógica de reoptimización. Los nombres del documento están en
// castellano; aquí se traducen a inglés por coherencia con el clean core
// (que es infra reutilizable inter-vertical e inter-mercado: ES → PT → DACH
// → LatAm). El mapeo documento ↔ código está en docs/core-contract.md v2.0.
//
// Esta sesión añade SOLO tipos. Los componentes que los consumen
// (Predictor, Validator, Generator, Simulator, Scorer, Coordinator) se
// implementan en Sesiones 12-17.
// =============================================================================

// -----------------------------------------------------------------------------
// 1. Auxiliares — distribuciones probabilísticas y rangos temporales
// -----------------------------------------------------------------------------

/**
 * Distribución de duración devuelta por el Predictor (C1) y consumida por el
 * Simulador (C4). Representa la incertidumbre sobre cuánto tiempo durará una
 * cita o procedimiento.
 *
 * Invariantes (verificados en types.test.ts):
 *  - mean > 0
 *  - stdDev >= 0
 *  - p10 <= p50 <= p90
 *  - p10 >= 0 (la duración no puede ser negativa)
 *
 * Documento de lógica: "DistribuciónDuración { media, desv, p10, p50, p90 }".
 */
export interface DurationDistribution {
  readonly mean: DurationMs;
  readonly stdDev: DurationMs;
  readonly p10: DurationMs;
  readonly p50: DurationMs;
  readonly p90: DurationMs;
}

/**
 * Distribución de minutos firmada. A diferencia de DurationDistribution,
 * permite valores negativos (paciente que llega antes de hora, profesional
 * que adelanta). Usada para predecir impuntualidad e inicios anticipados.
 *
 * Invariantes:
 *  - stdDev >= 0
 *  - p10 <= p50 <= p90
 *  - mean libre (puede ser negativo)
 *
 * Documento de lógica: "DistribuciónMinutos" (predict_impuntualidad).
 */
export interface MinutesDistribution {
  readonly mean: DurationMs;
  readonly stdDev: DurationMs;
  readonly p10: DurationMs;
  readonly p50: DurationMs;
  readonly p90: DurationMs;
}

/** Rango temporal cerrado [start, end). */
export interface TimeRange {
  readonly start: InstantUTC;
  readonly end: InstantUTC;
}

// -----------------------------------------------------------------------------
// 2. Eventos — API de entrada al motor (§11 documento de lógica)
//
// 12 tipos de evento como discriminated union sobre `kind`. Cada evento
// dispara una llamada a Coordinator.runCycle(event) en Sesión 17.
// -----------------------------------------------------------------------------

export type EventKind =
  | "patient_arrival"
  | "appointment_started"
  | "in_progress_update"
  | "appointment_completed"
  | "cancellation"
  | "no_show_detected"
  | "walk_in"
  | "professional_absence"
  | "equipment_unavailable"
  | "constraint_change"
  | "proactive_tick"
  | "manual_signal";

interface BaseEngineEvent {
  readonly instant: InstantUTC;
  /** Identificador opaco de la clínica (tenant). Convención del clean core. */
  readonly tenantId: string;
}

export interface PatientArrivalEvent extends BaseEngineEvent {
  readonly kind: "patient_arrival";
  readonly patientId: string;
  /** Negativo si llegó antes de hora, positivo si llegó tarde. */
  readonly observedPunctualityMs: DurationMs;
}

export interface AppointmentStartedEvent extends BaseEngineEvent {
  readonly kind: "appointment_started";
  readonly eventId: EventId;
}

export interface InProgressUpdateEvent extends BaseEngineEvent {
  readonly kind: "in_progress_update";
  readonly eventId: EventId;
  /**
   * Identificador de la fase clínica completada (ej. "canal_2_completado").
   * El motor no inspecciona el contenido — lo pasa al Predictor C1, que
   * conoce el catálogo de fases del procedimiento.
   */
  readonly completedPhase: string;
  readonly notes?: string;
}

export interface AppointmentCompletedEvent extends BaseEngineEvent {
  readonly kind: "appointment_completed";
  readonly eventId: EventId;
  readonly actualDuration: DurationMs;
}

export interface CancellationEvent extends BaseEngineEvent {
  readonly kind: "cancellation";
  readonly eventId: EventId;
  /** Antelación con la que se notificó la cancelación. */
  readonly noticeAheadMs: DurationMs;
  readonly reasonCode?: string;
}

export interface NoShowDetectedEvent extends BaseEngineEvent {
  readonly kind: "no_show_detected";
  readonly eventId: EventId;
}

export interface WalkInEvent extends BaseEngineEvent {
  readonly kind: "walk_in";
  /** Null si el paciente todavía no está dado de alta en el sistema. */
  readonly patientId: string | null;
  readonly requestedProcedureId: string;
  readonly urgency: 1 | 2 | 3 | 4 | 5;
}

export interface ProfessionalAbsenceEvent extends BaseEngineEvent {
  readonly kind: "professional_absence";
  readonly professionalId: ResourceId;
  readonly absenceRange: TimeRange;
}

export interface EquipmentUnavailableEvent extends BaseEngineEvent {
  readonly kind: "equipment_unavailable";
  readonly equipmentId: ResourceId;
  readonly unavailableRange: TimeRange;
  readonly reasonCode: string;
}

export interface ConstraintChangeEvent extends BaseEngineEvent {
  readonly kind: "constraint_change";
  readonly constraintRuleId: string;
  readonly changeType: "added" | "modified" | "removed" | "deactivated";
}

/** Reloj proactivo interno: dispara barridos del día restante cada N seg. */
export interface ProactiveTickEvent extends BaseEngineEvent {
  readonly kind: "proactive_tick";
}

/** El humano fuerza una reevaluación manual. */
export interface ManualSignalEvent extends BaseEngineEvent {
  readonly kind: "manual_signal";
  readonly signalType: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type EngineEvent =
  | PatientArrivalEvent
  | AppointmentStartedEvent
  | InProgressUpdateEvent
  | AppointmentCompletedEvent
  | CancellationEvent
  | NoShowDetectedEvent
  | WalkInEvent
  | ProfessionalAbsenceEvent
  | EquipmentUnavailableEvent
  | ConstraintChangeEvent
  | ProactiveTickEvent
  | ManualSignalEvent;

// -----------------------------------------------------------------------------
// 3. Vector de KPIs (§3 capa 5 + §10 documento de lógica)
//
// El Simulador (C4) devuelve un KPIVector esperado y otro de varianzas.
// El Puntuador (C5) lo combina linealmente con pesos de la clínica
// + penalización por varianza + penalización por coste de cambio.
// -----------------------------------------------------------------------------

export interface KPIVector {
  /** Utilización efectiva de gabinetes (0..1). */
  readonly effectiveUtilization: ScoreRatio;
  /** Overtime esperado total (todos los profesionales sumados). */
  readonly expectedOvertime: DurationMs;
  /** Tiempo medio de espera de pacientes en el día. */
  readonly meanWaitTime: DurationMs;
  /** Cantidad esperada de cancelaciones forzadas en el día. */
  readonly expectedForcedCancellations: number;
  /** Valor cobrable proyectado al final del día. */
  readonly projectedBillableValue: MonetaryAmount;
  /**
   * Riesgo agregado (varianza ponderada de los demás KPIs).
   * Derivado, no input directo: el Simulador lo calcula a partir
   * de las distribuciones p10/p90 de las predicciones.
   */
  readonly risk: number;
}

// -----------------------------------------------------------------------------
// 4. Estado del día (§9 bloque 2 documento de lógica)
//
// Objeto reconstruido en cada ciclo del Coordinador (C6). Es el "tablero"
// sobre el que se razona. Sin estado en memoria entre ciclos en la
// implementación inicial (decisión 2 del §12 doc).
// -----------------------------------------------------------------------------

export interface RoomState {
  readonly roomId: ResourceId;
  /** Tramos en los que la sala está ocupada hoy. */
  readonly occupiedRanges: ReadonlyArray<TimeRange>;
  /** Próximo instante en que la sala queda libre, o null si libre ya. */
  readonly nextAvailableAt: InstantUTC | null;
}

export interface ProfessionalState {
  readonly professionalId: ResourceId;
  /** Disponibilidad restante del día (rangos libres). */
  readonly remainingAvailability: ReadonlyArray<TimeRange>;
  /** EventId de la cita actualmente en curso, o null si está libre. */
  readonly currentAppointmentId: EventId | null;
  /** Tiempo acumulado trabajando hoy hasta currentInstant. */
  readonly accumulatedTodayMs: DurationMs;
}

export interface EquipmentReservation {
  readonly range: TimeRange;
  readonly forAppointmentId: EventId;
}

export interface EquipmentState {
  readonly equipmentId: ResourceId;
  /** Sala donde está físicamente ahora (si itinerante), null si fijo o no asignado. */
  readonly currentLocation: ResourceId | null;
  readonly reservations: ReadonlyArray<EquipmentReservation>;
  readonly nextAvailableAt: InstantUTC | null;
}

export type AppointmentRuntimeStatus =
  | "scheduled"
  | "confirmed"
  | "checked_in"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export interface AppointmentRisks {
  /** Probabilidad de que la cita se alargue más de lo planeado. */
  readonly overrunProbability: ScoreRatio;
  /** Probabilidad de no-show. */
  readonly noShowProbability: ScoreRatio;
  /** Probabilidad de llegada tardía significativa (>10 min). */
  readonly significantLatenessProbability: ScoreRatio;
}

export interface AppointmentState {
  readonly eventId: EventId;
  readonly runtimeStatus: AppointmentRuntimeStatus;
  /**
   * Distribución del fin estimado, recalculada cada ciclo.
   * Se interpreta como instante absoluto (epoch ms en UTC),
   * no como duración restante. Coincide estructuralmente con
   * DurationDistribution porque InstantUTC y DurationMs son ambos number en ms.
   *
   * Si runtimeStatus es "completed" o "cancelled", esta distribución
   * pierde sentido y los componentes deben ignorarla.
   */
  readonly estimatedEndDistribution: DurationDistribution;
  readonly detectedRisks: AppointmentRisks;
}

export interface DayState {
  readonly tenantId: string;
  /** Medianoche del día en UTC. */
  readonly date: InstantUTC;
  readonly currentInstant: InstantUTC;
  readonly rooms: ReadonlyArray<RoomState>;
  readonly professionals: ReadonlyArray<ProfessionalState>;
  readonly equipment: ReadonlyArray<EquipmentState>;
  /** Citas del día ordenadas por start ascendente. */
  readonly appointments: ReadonlyArray<AppointmentState>;
  /** Cola de eventos pendientes de procesar por el Coordinador. */
  readonly pendingEvents: ReadonlyArray<EngineEvent>;
  /** KPIs proyectados con la trayectoria actual ("no hacer nada"). */
  readonly currentProjectedKPIs: KPIVector;
}

// -----------------------------------------------------------------------------
// 5. Acciones primitivas y compuestas (§3 capa 4 + §10 documento de lógica)
//
// 10 primitivas como discriminated union sobre `kind`. Una AccionCompuesta
// es una secuencia de primitivas (ej. "mover López a Torres + invitar
// waitlist al hueco resultante de García"). El Generador (C3) produce
// candidatas componiendo primitivas.
// -----------------------------------------------------------------------------

export type ActionKind =
  | "move"
  | "compress"
  | "expand"
  | "advance"
  | "postpone"
  | "reassign_professional"
  | "reassign_resource"
  | "fill_from_waitlist"
  | "cancel_and_reschedule"
  | "no_op";

/** Mover una cita a un nuevo slot (instante + recurso). */
export interface MoveAction {
  readonly kind: "move";
  readonly eventId: EventId;
  readonly newStart: InstantUTC;
  readonly newResourceId: ResourceId;
}

/** Acortar la duración reservada de una cita (newDuration < duración actual). */
export interface CompressAction {
  readonly kind: "compress";
  readonly eventId: EventId;
  readonly newDuration: DurationMs;
}

/** Alargar la duración reservada de una cita (newDuration > duración actual). */
export interface ExpandAction {
  readonly kind: "expand";
  readonly eventId: EventId;
  readonly newDuration: DurationMs;
}

/** Adelantar el inicio de una cita (paciente ya presente puede empezar antes). */
export interface AdvanceAction {
  readonly kind: "advance";
  readonly eventId: EventId;
  readonly newStart: InstantUTC;
}

/** Avisar al paciente que llegue más tarde de lo previsto. */
export interface PostponeAction {
  readonly kind: "postpone";
  readonly eventId: EventId;
  readonly newStart: InstantUTC;
  /** True si la acción incluye notificar al paciente (SMS, llamada, etc.). */
  readonly notifyPatient: boolean;
}

/** Cambiar el profesional asignado a una cita. */
export interface ReassignProfessionalAction {
  readonly kind: "reassign_professional";
  readonly eventId: EventId;
  readonly newProfessionalId: ResourceId;
}

/** Cambiar la sala o el equipamiento asignado a una cita. */
export interface ReassignResourceAction {
  readonly kind: "reassign_resource";
  readonly eventId: EventId;
  readonly resourceKind: "room" | "equipment";
  readonly newResourceId: ResourceId;
}

/** Encolar un candidato de waitlist en un hueco compatible. */
export interface FillFromWaitlistAction {
  readonly kind: "fill_from_waitlist";
  readonly waitingCandidateId: CandidateId;
  readonly gapStart: InstantUTC;
  readonly gapResourceId: ResourceId;
  readonly proposedDuration: DurationMs;
}

/** Cancelar la cita y mover a otro día (último recurso). */
export interface CancelAndRescheduleAction {
  readonly kind: "cancel_and_reschedule";
  readonly eventId: EventId;
  /** Ventana propuesta para reagendar. Opcional: el motor puede dejar al humano elegir. */
  readonly reschedulingWindow?: TimeRange;
}

/** Acción explícita de "no hacer nada" — siempre presente como candidata. */
export interface NoOpAction {
  readonly kind: "no_op";
}

export type PrimitiveAction =
  | MoveAction
  | CompressAction
  | ExpandAction
  | AdvanceAction
  | PostponeAction
  | ReassignProfessionalAction
  | ReassignResourceAction
  | FillFromWaitlistAction
  | CancelAndRescheduleAction
  | NoOpAction;

/**
 * Acción compuesta: secuencia de primitivas que se aplican juntas
 * como una unidad de decisión. Ejemplo:
 *   [
 *     { kind: "reassign_professional", eventId: "lopez", ... },
 *     { kind: "fill_from_waitlist", waitingCandidateId: "ruiz", ... }
 *   ]
 *
 * Una composición vacía es inválida — debe contener al menos NoOpAction
 * para representar "no actuar" como decisión explícita.
 */
export type CompositeAction = ReadonlyArray<PrimitiveAction>;

// Validación estructural de coherencia mínima de una CompositeAction.
// Esto no es lógica del motor — es validación de tipos. Vive aquí porque
// los tests del modelo mental (Sesión 10) la necesitan, y porque cualquier
// componente que produzca composiciones (Generador C3) debe poder validarlas
// antes de devolverlas.

export type CompositionIssueCode =
  /** La composición está vacía. */
  | "EMPTY_COMPOSITION"
  /** Misma primitiva del mismo kind sobre el mismo eventId más de una vez. */
  | "DUPLICATE_PRIMITIVE_ON_EVENT"
  /** Primitivas mutuamente excluyentes sobre el mismo eventId
   *  (ej. move + cancel_and_reschedule sobre el mismo evento). */
  | "CONFLICTING_PRIMITIVES_ON_EVENT"
  /** NoOpAction coexiste con otras primitivas — semánticamente inconsistente. */
  | "NO_OP_WITH_OTHER_ACTIONS";

export interface CompositionIssue {
  readonly code: CompositionIssueCode;
  readonly affectedEventId?: EventId;
  /** Diagnóstico para devs y tests, NO destinado al usuario final. */
  readonly message: string;
}

export interface CompositionValidation {
  readonly valid: boolean;
  readonly issues: ReadonlyArray<CompositionIssue>;
}

/**
 * Conjunto de kinds de acción que se consideran mutuamente excluyentes
 * cuando aplican sobre el mismo eventId. Lista deliberadamente conservadora:
 * solo los pares cuya combinación carece de sentido operativo claro.
 */
const CONFLICTING_KINDS: ReadonlyArray<readonly [ActionKind, ActionKind]> = [
  ["move", "cancel_and_reschedule"],
  ["advance", "postpone"],
  ["compress", "expand"],
  ["cancel_and_reschedule", "advance"],
  ["cancel_and_reschedule", "postpone"],
  ["cancel_and_reschedule", "compress"],
  ["cancel_and_reschedule", "expand"],
];

function actionEventId(a: PrimitiveAction): EventId | null {
  switch (a.kind) {
    case "no_op":
    case "fill_from_waitlist":
      return null;
    default:
      return a.eventId;
  }
}

function kindsConflict(k1: ActionKind, k2: ActionKind): boolean {
  return CONFLICTING_KINDS.some(
    ([a, b]) => (a === k1 && b === k2) || (a === k2 && b === k1),
  );
}

/**
 * Comprueba la coherencia estructural mínima de una CompositeAction.
 * No evalúa viabilidad operativa contra el estado del día —de eso se
 * encarga el Validator (C2) en Sesión 13.
 */
export function validateCompositionCoherence(
  composition: CompositeAction,
): CompositionValidation {
  const issues: CompositionIssue[] = [];

  if (composition.length === 0) {
    issues.push({
      code: "EMPTY_COMPOSITION",
      message:
        "Composition is empty. Use [{ kind: 'no_op' }] to represent the explicit no-action decision.",
    });
    return { valid: false, issues };
  }

  const hasNoOp = composition.some((a) => a.kind === "no_op");
  if (hasNoOp && composition.length > 1) {
    issues.push({
      code: "NO_OP_WITH_OTHER_ACTIONS",
      message:
        "no_op cannot coexist with other primitives in the same composition.",
    });
  }

  // Detectar duplicados y conflictos entre primitivas que afectan al mismo eventId.
  const byEvent = new Map<EventId, PrimitiveAction[]>();
  for (const action of composition) {
    const eid = actionEventId(action);
    if (eid === null) continue;
    const list = byEvent.get(eid) ?? [];
    list.push(action);
    byEvent.set(eid, list);
  }

  for (const [eid, actions] of byEvent) {
    // Duplicados: mismo kind sobre el mismo evento.
    const seenKinds = new Set<ActionKind>();
    for (const a of actions) {
      if (seenKinds.has(a.kind)) {
        issues.push({
          code: "DUPLICATE_PRIMITIVE_ON_EVENT",
          affectedEventId: eid,
          message: `Duplicate primitive '${a.kind}' on event '${eid}'.`,
        });
      } else {
        seenKinds.add(a.kind);
      }
    }
    // Conflictos: pares mutuamente excluyentes.
    for (let i = 0; i < actions.length; i++) {
      for (let j = i + 1; j < actions.length; j++) {
        if (kindsConflict(actions[i].kind, actions[j].kind)) {
          issues.push({
            code: "CONFLICTING_PRIMITIVES_ON_EVENT",
            affectedEventId: eid,
            message: `Primitives '${actions[i].kind}' and '${actions[j].kind}' conflict on event '${eid}'.`,
          });
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

// -----------------------------------------------------------------------------
// 6. Validación de restricciones (§5 + §10 C2 documento de lógica)
//
// Resultado del Componente 2 (Validator) cuando comprueba si un estado
// hipotético cumple las restricciones de la clínica. Hard violations
// invalidan la acción; soft violations penalizan el score.
// -----------------------------------------------------------------------------

export type ConstraintHardness = "hard" | "soft";

export type ConstraintCode =
  | "CLINICAL_SAFETY"
  | "LEGAL_REGULATORY"
  | "PHYSICAL"
  | "PROFESSIONAL_HOURS"
  | "PROFESSIONAL_BREAK"
  | "PATIENT_PREFERENCE"
  | "PATIENT_TOLERANCE"
  | "PATIENT_AVAILABILITY"
  | "RESOURCE_AVAILABILITY"
  | "CHAINING"
  | "INFORMATION_DEPENDENCY"
  | "ECONOMIC_DEPENDENCY";

export interface ConstraintViolation {
  readonly code: ConstraintCode;
  readonly hardness: ConstraintHardness;
  /** Coste de la violación si es soft. 0 si es hard (no procede). */
  readonly cost: ScoreRatio;
  readonly affectedEventIds: ReadonlyArray<EventId>;
  readonly affectedResourceIds: ReadonlyArray<ResourceId>;
}

export interface ValidationResult {
  /** True si no hay hard violations. Soft violations no invalidan. */
  readonly valid: boolean;
  readonly hardViolations: ReadonlyArray<ConstraintViolation>;
  readonly softViolations: ReadonlyArray<ConstraintViolation>;
}

// -----------------------------------------------------------------------------
// 7. Simulación (§10 C4 documento de lógica)
//
// Resultado del Componente 4 (Simulator) tras simular una CompositeAction
// aplicada al estado del día. La implementación inicial (Sesión 15) es
// determinista usando p50 + varianza calculada de p10/p90; futuras versiones
// añaden Monte Carlo con N muestras (decisión registrada en master §10).
// -----------------------------------------------------------------------------

export type ProjectedEventKind =
  | "potential_overrun"
  | "potential_no_show"
  | "potential_late_arrival"
  | "potential_forced_cancellation";

export interface ProjectedEvent {
  readonly kind: ProjectedEventKind;
  readonly affectedEventId: EventId;
  readonly probability: ScoreRatio;
  readonly expectedAt: InstantUTC;
}

export type CriticalPointKind =
  | "overrun_starts_propagating"
  | "wait_threshold_exceeded"
  | "professional_overtime_starts"
  | "equipment_conflict"
  | "patient_tolerance_breached";

export interface CriticalPoint {
  readonly instant: InstantUTC;
  readonly kind: CriticalPointKind;
  readonly affectedEventIds: ReadonlyArray<EventId>;
}

export interface SimulationResult {
  /** KPIs esperados (medianas / valores p50). */
  readonly expectedKPIs: KPIVector;
  /**
   * Varianza de cada KPI, calculada a partir de las distribuciones p10/p90
   * del Predictor. Cada campo de KPIVector aquí es la varianza estimada del
   * mismo campo de expectedKPIs.
   */
  readonly varianceKPIs: KPIVector;
  readonly projectedEvents: ReadonlyArray<ProjectedEvent>;
  readonly criticalPoints: ReadonlyArray<CriticalPoint>;
}

// -----------------------------------------------------------------------------
// 8. Decisión y explicación (§3 capa 8/9 + §10 C6 documento de lógica)
//
// Output final del Coordinador (C6). La Explanation contiene la propuesta,
// alternativas consideradas, qué pasaría si se rechaza, y los motivos del
// razonamiento — todo en formato código (sin strings de usuario, que viven
// en ui/i18n/{locale}.json).
// -----------------------------------------------------------------------------

export type AutonomyLevel =
  | "auto_executable"
  | "quick_suggestion"
  | "detailed_suggestion"
  | "notify_only";

export type DiscardReasonCode =
  /** Otra alternativa la domina en todos los KPIs relevantes. */
  | "DOMINATED_BY_ALTERNATIVE"
  /** Viola al menos una restricción dura. */
  | "HARD_CONSTRAINT_VIOLATION"
  /** Score esperado bueno pero varianza demasiado alta. */
  | "HIGH_VARIANCE"
  /** El coste de cambio (avisos, fricción) supera el beneficio. */
  | "HIGH_CHANGE_COST"
  /** Depende de una respuesta externa (paciente acepta/rechaza aviso). */
  | "DEPENDS_ON_EXTERNAL_RESPONSE"
  /** Mejora marginal sobre no_op por debajo del umbral de propuesta. */
  | "MARGINAL_IMPROVEMENT"
  /** Score peor que no_op. */
  | "WORSE_THAN_NO_OP";

export interface ConsideredAlternative {
  readonly action: CompositeAction;
  /**
   * Score combinado (lineal ponderado + penalizaciones). Puede caer fuera
   * de [0,1] porque incorpora penalizaciones por varianza y coste de cambio.
   */
  readonly score: number;
  readonly projectedKPIs: KPIVector;
  readonly discardReasonCode: DiscardReasonCode;
}

export type ExplanationMotiveCode =
  | "PREVENTS_OVERRUN_PROPAGATION"
  | "REDUCES_WAIT_TIME"
  | "FILLS_GAP_WITH_VALUE"
  | "PREVENTS_FORCED_CANCELLATION"
  | "AVOIDS_OVERTIME"
  | "RECOVERS_BILLABLE_VALUE"
  | "REASSIGNS_TO_AVAILABLE_PROFESSIONAL"
  | "RESPECTS_PATIENT_TOLERANCE"
  | "USES_FREED_RESOURCE";

export interface Explanation {
  readonly recommendedAction: CompositeAction;
  readonly motiveCode: ExplanationMotiveCode;
  /**
   * Top-K alternativas consideradas, ordenadas por score DESCENDENTE
   * (la mejor primero). Invariante verificada en types.test.ts.
   */
  readonly consideredAlternatives: ReadonlyArray<ConsideredAlternative>;
  /** KPIs proyectados si el humano rechaza la propuesta (= proyección no_op). */
  readonly ifRejectedKPIs: KPIVector;
  /** KPIs proyectados si se acepta la recomendación. */
  readonly projectedKPIs: KPIVector;
}

export interface CycleDecision {
  /**
   * Acción propuesta al humano. Null cuando no_op gana o cuando ninguna
   * candidata supera el umbral mínimo de mejora sobre no_op.
   */
  readonly proposal: CompositeAction | null;
  readonly explanation: Explanation;
  readonly autonomyLevel: AutonomyLevel;
  /**
   * Acciones que el motor ya ejecutó automáticamente sin esperar
   * confirmación humana (políticas de autonomía "auto_executable").
   */
  readonly autoExecutedActions: ReadonlyArray<PrimitiveAction>;
}