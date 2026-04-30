/**
 * Tipos de entrada del Simulator (C4) — Sesión 15.
 *
 * Análogo a ValidationContext (validator.ts) pero con dos diferencias:
 *   - Añade priceByProcedureId para computeProjectedBillableValue.
 *   - Omite rooms y patientHistoryById (no consumidos por ningún KPI v1).
 *
 * Decisión consciente: el Simulator NO importa de validator.ts ni viceversa.
 * Componentes hermanos del clean core son independientes; el acoplamiento
 * va vía types.ts, domain-types.ts y state-transitions.ts. Esto permite
 * que Sesión 18 pueda refactorizar cualquiera sin tocar los demás.
 *
 * Semántica de AppointmentState.estimatedEndDistribution: este componente
 * la interpreta como DURACIÓN (cuánto va a durar la cita medido desde su
 * start), consistente con cómo state-transitions la trata al escalarla en
 * applyCompress/applyExpand. El comentario en types.ts que la describe como
 * "instante absoluto" está en tensión con el comportamiento real del motor;
 * registrado como deuda blanda ESTIMATED_END_DISTRIBUTION_SEMANTICS_DRIFT
 * para resolución en Sesión 18.
 */

import type {
  AppointmentRuntimeMap,
  ApplyOptions,
} from "./state-transitions";
import type {
  EquipmentInfo,
  ProcedureRequirements,
  ProfessionalCapabilities,
} from "./domain-types";
import type { MonetaryAmount, ResourceId } from "./primitives";

// =============================================================================
// Contexto de simulación
// =============================================================================

/**
 * Datos del catálogo y configuración del tenant que el Simulator consulta.
 * Lo construye el adapter (Sesión 17) cargando desde DB.
 *
 * El argumento `runtimes` debe corresponder al MISMO instante que el DayState
 * pasado a simulate(). Uno y otro se mantienen sincronizados por el adapter.
 *
 * Notas sobre cobertura v1:
 *   - rooms NO se incluye porque ningún KPI v1 las consulta. Sesión 16+
 *     puede añadirlas si el Scorer las necesita.
 *   - patientHistoryById NO se incluye porque CHAINING vive en el Validator,
 *     no en el Simulator. El Simulator asume que la acción ya pasó por C2
 *     antes de llegar aquí (invariante I-26).
 */
export interface SimulationContext {
  readonly runtimes: AppointmentRuntimeMap;
  readonly professionals: ReadonlyArray<ProfessionalCapabilities>;
  readonly equipment: ReadonlyArray<EquipmentInfo>;
  readonly proceduresById: Readonly<Record<ResourceId, ProcedureRequirements>>;
  /**
   * Precio cobrable por procedimiento. Si un procedureId no aparece en el
   * map, el appointment correspondiente contribuye 0 al projectedBillableValue
   * (equivale a "procedimiento sin activación de precio en este tenant,
   * no cobrable proyectado").
   *
   * Refleja ProcedureActivation.price del schema. El adapter resuelve la
   * activación correcta del tenant antes de pasarlo aquí.
   */
  readonly priceByProcedureId: Readonly<Record<ResourceId, MonetaryAmount>>;
}

// =============================================================================
// Opciones de simulación
// =============================================================================

/**
 * Opciones para configurar el comportamiento del Simulator. Todos los campos
 * son opcionales con defaults exportados más abajo.
 */
export interface SimulationOptions {
  /**
   * Umbral mínimo de probabilidad de overrun para emitir un
   * ProjectedEvent con kind "potential_overrun". Default
   * DEFAULT_OVERRUN_PROB_THRESHOLD (0.3).
   */
  readonly overrunProbabilityThreshold?: number;

  /**
   * Umbral mínimo de probabilidad de no-show para emitir un
   * ProjectedEvent con kind "potential_no_show". Default
   * DEFAULT_NO_SHOW_PROB_THRESHOLD (0.3).
   */
  readonly noShowProbabilityThreshold?: number;

  /**
   * Umbral mínimo de probabilidad de llegada tardía significativa para
   * emitir un ProjectedEvent con kind "potential_late_arrival". Default
   * DEFAULT_LATE_ARRIVAL_PROB_THRESHOLD (0.3).
   */
  readonly lateArrivalProbabilityThreshold?: number;

  /**
   * Opciones que se propagan a applyComposite (state-transitions). Necesarias
   * cuando la CompositeAction incluye fill_from_waitlist y por tanto requiere
   * el FillFromWaitlistContext (waitingCandidates + resolveProfessional).
   *
   * Si la acción no contiene fill_from_waitlist, se puede omitir.
   */
  readonly applyOptions?: ApplyOptions;
}

// =============================================================================
// Defaults exportados (consumibles desde tests y desde el adapter)
// =============================================================================

/** Umbral default para emitir ProjectedEvent.potential_overrun. */
export const DEFAULT_OVERRUN_PROB_THRESHOLD = 0.3;

/** Umbral default para emitir ProjectedEvent.potential_no_show. */
export const DEFAULT_NO_SHOW_PROB_THRESHOLD = 0.3;

/** Umbral default para emitir ProjectedEvent.potential_late_arrival. */
export const DEFAULT_LATE_ARRIVAL_PROB_THRESHOLD = 0.3;