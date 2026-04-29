/**
 * Predictor (C1) — Sesión 12.
 *
 * Primer componente vivo del clean core. Implementa las 5 APIs del Componente 1
 * según core-contract.md §6 y logica-reoptimizacion-saas.md §10:
 *
 *   predictDuration(ctx)         → DurationDistribution
 *   predictNoShow(scores)        → ScoreRatio
 *   predictLateness(scores)      → MinutesDistribution
 *   predictAdviceAcceptance(s)   → ScoreRatio
 *   updateInProgress(ctx)        → DurationDistribution
 *
 * Política de Sesión 12 (master §8): SIN ML. Distribuciones del catálogo
 * + reglas de fallback. Gradient boosting se difiere a sesión post-piloto.
 *
 * Funciones puras, sin estado oculto, sin acceso a Prisma. La capa adapter
 * (lib/adapters/predictor-loader.ts, Sesión 17/18) cargará datos de DB y
 * los pasará a estas funciones como argumentos tipados.
 */

import type {
  DurationDistribution,
  MinutesDistribution,
} from "./types";
import type { DurationMs, ScoreRatio } from "./primitives";
import type {
  DurationPredictionContext,
  InProgressContext,
  PatientPredictiveScores,
  ProcedureDistributions,
} from "./predictor-types";

// =============================================================================
// Constantes públicas — priors (cold start)
// =============================================================================

/**
 * Tasa prior de no-show cuando no hay datos del paciente.
 * Literatura odontológica reporta 5-30% según contexto. 5% es prior
 * conservadora (asume mejor caso) — el sistema se ajustará con datos reales.
 */
export const PRIOR_NO_SHOW_RATE: ScoreRatio = 0.05;

/**
 * Distribución prior de impuntualidad (minutos) cuando no hay datos.
 * Pacientes en general llegan ligeramente tarde con varianza moderada.
 */
export const PRIOR_LATENESS_MEAN_MIN: number = 0;
export const PRIOR_LATENESS_STDDEV_MIN: number = 5;
export const PRIOR_LATENESS_P10_MIN: number = -3;
export const PRIOR_LATENESS_P50_MIN: number = 0;
export const PRIOR_LATENESS_P90_MIN: number = 8;

/**
 * Probabilidad prior de aceptación de aviso (50%) cuando no hay datos.
 * Es deliberadamente neutra — no asume nada del paciente.
 */
export const PRIOR_ADVICE_ACCEPTANCE: ScoreRatio = 0.5;

/**
 * Factor de compresión para updateInProgress cuando se completa la última fase
 * documentada del procedimiento. La distribución previa (en ms) se comprime
 * por este factor (mean × 0.2) — "queda poco". Heurística sin ML; cuando llegue
 * el modelo real esto se sustituye por inferencia bayesiana sobre fases × duración.
 */
export const FINAL_PHASE_COMPRESSION_FACTOR: number = 0.2;

// =============================================================================
// Helpers internos — conversión y validación
// =============================================================================

const MS_PER_MINUTE = 60 * 1000;

function minutesToMs(minutes: number): DurationMs {
  return minutes * MS_PER_MINUTE;
}

function clampToScoreRatio(value: number): ScoreRatio {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Convierte una distribución en minutos (catálogo) a DurationDistribution
 * en milisegundos (clean core). Asume invariantes I-8 ya cumplidos sobre
 * la entrada — el seed valida esto al cargar el catálogo. Si no, sería bug
 * de fuente y queremos que falle ruidoso (no clampar silenciosamente).
 */
function distributionMinutesToDuration(
  d: ProcedureDistributions,
): DurationDistribution {
  return {
    mean: minutesToMs(d.mean),
    stdDev: minutesToMs(d.stdDev),
    p10: minutesToMs(d.p10),
    p50: minutesToMs(d.p50),
    p90: minutesToMs(d.p90),
  };
}

/**
 * Comprime una distribución en minutos por un factor multiplicativo.
 * Mantiene la forma (proporciones entre cuantiles) y los invariantes I-8.
 * stdDev se comprime por el mismo factor (asunción razonable: la varianza
 * relativa se mantiene cuando "queda poco").
 */
function compressDistribution(
  d: ProcedureDistributions,
  factor: number,
): ProcedureDistributions {
  return {
    mean: d.mean * factor,
    stdDev: d.stdDev * factor,
    p10: d.p10 * factor,
    p50: d.p50 * factor,
    p90: d.p90 * factor,
  };
}

// =============================================================================
// API 1 — predictDuration
// =============================================================================

/**
 * Predice la distribución de duración de una cita.
 *
 * Política v1 (Sesión 12, sin ML):
 *  - Si activation.learnedDistribution existe → usarla.
 *  - Si no → fallback a procedure.referenceDistribution.
 *
 * Coherencia interna: en el cold start (seed Sesión 11B), learned = reference,
 * así que ambos caminos producen el mismo output al inicio. La divergencia
 * aparecerá cuando se añada un mecanismo de aprendizaje (post-piloto).
 *
 * Invariantes garantizados en output:
 *  - mean > 0 (asumiendo invariantes en input cumplidos)
 *  - stdDev >= 0
 *  - p10 <= p50 <= p90
 *  - p10 >= 0
 *
 * @throws nunca — la función nunca falla con inputs estructuralmente válidos.
 *   Si activation/procedure tienen distribuciones inválidas (ej. mean negativo),
 *   el output reflejará esa invalidez. La validación es responsabilidad del
 *   adapter (que aplica las invariantes I-8 antes de pasar a esta función).
 */
export function predictDuration(
  ctx: DurationPredictionContext,
): DurationDistribution {
  const source =
    ctx.activation.learnedDistribution ?? ctx.procedure.referenceDistribution;
  return distributionMinutesToDuration(source);
}

// =============================================================================
// API 2 — predictNoShow
// =============================================================================

/**
 * Predice la probabilidad de no-show de una cita.
 *
 * Política v1: si scores.noShowScore existe → usarlo (clampado a [0,1]
 * por defensividad). Si null → PRIOR_NO_SHOW_RATE.
 *
 * El parámetro es PatientPredictiveScores (no appointmentId) porque el
 * Predictor es puro: la conversión appointmentId → paciente → scores la
 * hace el adapter. Esto difiere ligeramente de la firma del contrato §6
 * que dice "predictNoShow(appointmentId)" — la firma del contrato es
 * conceptual; la implementación recibe los datos ya cargados.
 */
export function predictNoShow(scores: PatientPredictiveScores): ScoreRatio {
  if (scores.noShowScore === null) return PRIOR_NO_SHOW_RATE;
  return clampToScoreRatio(scores.noShowScore);
}

// =============================================================================
// API 3 — predictLateness
// =============================================================================

/**
 * Predice la distribución de impuntualidad (minutos) de un paciente.
 *
 * MinutesDistribution permite mean negativo (paciente que llega antes de hora).
 *
 * Política v1:
 *  - Si latenessMeanMinutes Y latenessStdDevMinutes existen → construir
 *    distribución sintética alrededor de esos valores. p10/p50/p90 derivados
 *    asumiendo distribución aproximadamente normal: p10 = mean - 1.28*stdDev,
 *    p50 = mean, p90 = mean + 1.28*stdDev.
 *  - Si alguno es null → distribución prior (constantes documentadas arriba).
 *
 * El ajuste a [p10, p50, p90] derivado garantiza el invariante I-9
 * (p10 <= p50 <= p90) cuando stdDev >= 0.
 */
export function predictLateness(
  scores: PatientPredictiveScores,
): MinutesDistribution {
  const mean = scores.latenessMeanMinutes;
  const stdDev = scores.latenessStdDevMinutes;

  if (mean === null || stdDev === null) {
    return {
      mean: minutesToMs(PRIOR_LATENESS_MEAN_MIN),
      stdDev: minutesToMs(PRIOR_LATENESS_STDDEV_MIN),
      p10: minutesToMs(PRIOR_LATENESS_P10_MIN),
      p50: minutesToMs(PRIOR_LATENESS_P50_MIN),
      p90: minutesToMs(PRIOR_LATENESS_P90_MIN),
    };
  }

  const safeStdDev = stdDev < 0 ? 0 : stdDev;
  const Z = 1.28; // z-score aproximado para p10/p90 en distribución normal
  return {
    mean: minutesToMs(mean),
    stdDev: minutesToMs(safeStdDev),
    p10: minutesToMs(mean - Z * safeStdDev),
    p50: minutesToMs(mean),
    p90: minutesToMs(mean + Z * safeStdDev),
  };
}

// =============================================================================
// API 4 — predictAdviceAcceptance
// =============================================================================

/**
 * Predice la probabilidad de que el paciente acepte un aviso (mover cita,
 * llegar antes, etc.).
 *
 * Política v1: si acceptAdviceScore existe → usarlo (clampado).
 *              Si null → PRIOR_ADVICE_ACCEPTANCE (50%).
 *
 * v2 (post-piloto): incorporará canal (sms/llamada/email) y antelación,
 * que en v1 se ignoran deliberadamente.
 */
export function predictAdviceAcceptance(
  scores: PatientPredictiveScores,
): ScoreRatio {
  if (scores.acceptAdviceScore === null) return PRIOR_ADVICE_ACCEPTANCE;
  return clampToScoreRatio(scores.acceptAdviceScore);
}

// =============================================================================
// API 5 — updateInProgress
// =============================================================================

/**
 * Actualiza la distribución de duración de una cita en curso a partir de un
 * evento InProgressUpdateEvent (fase clínica completada).
 *
 * Política v1 (sin ML):
 *  - Si procedure.orderedPhases no está documentado → devolver previousDistribution
 *    convertida a ms sin cambios. Sin información para actualizar.
 *  - Si la fase completada coincide con la última de orderedPhases → comprimir
 *    distribución por FINAL_PHASE_COMPRESSION_FACTOR (queda poco trabajo).
 *  - Si la fase completada es intermedia o no aparece en orderedPhases →
 *    devolver previousDistribution sin cambios.
 *
 * v2 (post-piloto): inferencia bayesiana sobre (fase completada, fases
 * restantes, duraciones históricas por fase) para una actualización más fina.
 */
export function updateInProgress(
  ctx: InProgressContext,
): DurationDistribution {
  const phases = ctx.procedure.orderedPhases;

  // Sin fases documentadas → no hay base para actualizar.
  if (phases === undefined || phases.length === 0) {
    return distributionMinutesToDuration(ctx.previousDistribution);
  }

  const lastPhase = phases[phases.length - 1];
  if (ctx.completedPhase === lastPhase) {
    const compressed = compressDistribution(
      ctx.previousDistribution,
      FINAL_PHASE_COMPRESSION_FACTOR,
    );
    return distributionMinutesToDuration(compressed);
  }

  // Fase intermedia o no documentada → distribución previa sin cambios.
  return distributionMinutesToDuration(ctx.previousDistribution);
}