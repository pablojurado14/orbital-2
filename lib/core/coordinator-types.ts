/**
 * Tipos del Coordinator (C6) — Sesión 17.
 *
 * Sexto y último componente vivo del clean core. Orquesta el ciclo
 * "observar-pensar-proponer" combinando C2 Validator, C3 Generator,
 * C4 Simulator y C5 Scorer en cada llamada a runCycle().
 *
 * Decisión Sesión 17: el Coordinator NO llama a C1 Predictor en v1.
 * Asume que el DayState que recibe ya viene "predicho" por el adapter.
 * Documentado como COORDINATOR-PREDICTOR-INTEGRATION-V1.
 *
 * El Coordinator es el ÚNICO componente que conoce el flujo completo.
 * Los demás son "tontos en el sentido bueno": hacen su trabajo cuando
 * se les llama. Esto facilita testing y evolución.
 */

import type {
  GenerationContext,
  GenerationOptions,
  GenerationTrigger,
} from "./generator-types";
import type { ValidationContext } from "./validator";
import type { SimulationContext, SimulationOptions } from "./simulator-types";
import type { ScorerOptions } from "./scorer-types";
import type { ApplyOptions } from "./state-transitions";

// =============================================================================
// Contextos agregados
// =============================================================================

/**
 * Agregación de los contexts que cada componente del clean core necesita.
 * El adapter (Sesión 18) construye este objeto cargando desde DB y lo pasa
 * al Coordinator. El Coordinator no inventa contexts — los reutiliza.
 *
 * Por qué cada uno:
 *   - generation: GenerationContext lleva waitingCandidates + gaps + cancelled
 *     events que el Generator necesita.
 *   - validation: ValidationContext lleva runtimes + professionals + rooms +
 *     equipment + procedures + patientHistory.
 *   - simulation: SimulationContext lleva runtimes + professionals + equipment
 *     + procedures + priceByProcedureId.
 *
 * Los runtimes aparecen en los tres contexts por simetría — el Coordinator
 * pasa el mismo AppointmentRuntimeMap a los tres. Convención del adapter.
 */
export interface CoordinatorContexts {
  readonly generation: GenerationContext;
  readonly validation: ValidationContext;
  readonly simulation: SimulationContext;
}

// =============================================================================
// Opciones del Coordinator
// =============================================================================

/**
 * Opciones de configuración del Coordinator. Todas opcionales con defaults
 * exportados.
 */
export interface CoordinatorOptions {
  /**
   * Umbral mínimo de mejora del score sobre no_op para que una candidata
   * sea elegible como propuesta. Si ninguna candidata supera este umbral,
   * el Coordinator devuelve proposal=null y autonomyLevel=detailed_suggestion
   * con motiveCode derivado de la mejor descartada.
   *
   * Default DEFAULT_IMPROVEMENT_THRESHOLD (0.05).
   */
  readonly improvementThreshold?: number;

  /**
   * Número máximo de alternativas consideradas que se incluyen en
   * Explanation.consideredAlternatives. Las K mejores por score descendente
   * tras la ganadora. Default DEFAULT_TOP_K_ALTERNATIVES (3).
   */
  readonly topKAlternatives?: number;

  /** Opciones que se propagan a C3 Generator. */
  readonly generationOptions?: GenerationOptions;
  /** Opciones que se propagan a C4 Simulator. */
  readonly simulationOptions?: SimulationOptions;
  /** Opciones que se propagan a C5 Scorer. */
  readonly scorerOptions?: ScorerOptions;
  /**
   * Opciones que se propagan a applyComposite (vía Validator y Simulator)
   * cuando las candidatas incluyen fill_from_waitlist. Si ninguna lo incluye,
   * se puede omitir.
   */
  readonly applyOptions?: ApplyOptions;
}

// =============================================================================
// Defaults exportados
// =============================================================================

/** Mejora mínima sobre no_op para considerar una candidata elegible. */
export const DEFAULT_IMPROVEMENT_THRESHOLD = 0.05;

/** Número de alternativas que se incluyen en Explanation. */
export const DEFAULT_TOP_K_ALTERNATIVES = 3;

// =============================================================================
// Mapeo EngineEvent → GenerationTrigger (helper público)
// =============================================================================

/**
 * Trigger inferido a partir del kind del evento. Null si el evento no tiene
 * mapeo directo a un trigger del Generator en v1.
 *
 * Eventos cubiertos en v1 con trigger directo:
 *   - "cancellation" → "gap_detected"
 *   - "no_show_detected" → "no_show"
 *   - "professional_absence" → "professional_unavailable"
 *   - "proactive_tick" → "proactive_sweep"
 *
 * Eventos cubiertos en v1 con trigger condicional:
 *   - "appointment_completed" con duración > p90 estimado del state →
 *     "overrun_propagation". El Coordinator decide internamente si aplica.
 *
 * Eventos no cubiertos en v1 (devuelven null trigger):
 *   - patient_arrival, appointment_started, in_progress_update,
 *     walk_in, equipment_unavailable, constraint_change, manual_signal.
 *
 * Limitación reconocida: COORDINATOR-EVENT-TRIGGER-COVERAGE-V1.
 */
export interface TriggerInference {
  readonly trigger: GenerationTrigger | null;
  /**
   * Si la inferencia depende del state (overrun_propagation), aquí se
   * documenta para diagnóstico. Null si la inferencia es directa por kind.
   */
  readonly conditional: boolean;
}