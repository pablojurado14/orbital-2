/**
 * Tipos de input del Predictor (C1) — Sesión 12.
 *
 * El Predictor es una función pura del clean core. NUNCA importa de Prisma
 * ni accede a DB. Recibe estos tipos como entrada y devuelve los tipos del
 * modelo mental (DurationDistribution, MinutesDistribution, ScoreRatio).
 *
 * La capa de adapter (lib/adapters/predictor-loader.ts, Sesión 17 / 18)
 * convertirá filas de Prisma en estos tipos. Mientras tanto, los tests
 * los construyen literalmente.
 *
 * Convención de unidades:
 *  - Catálogo en DB: minutos (Float).
 *  - Tipos del clean core: milisegundos (DurationMs en primitives).
 *  - Estos tipos intermedios: minutos (provienen del catálogo).
 *  - El Predictor convierte minutos → ms antes de devolver al core.
 *
 * Documento de referencia: logica-reoptimizacion-saas.md §7 + §10 C1.
 */

/**
 * Distribución expresada en MINUTOS (tal y como se persiste en
 * Procedure.referenceDuration* y ProcedureActivation.learnedDuration*).
 *
 * Invariantes (mismos que DurationDistribution del core):
 *  - mean > 0
 *  - stdDev >= 0
 *  - p10 <= p50 <= p90
 *  - p10 >= 0
 */
export interface ProcedureDistributions {
  readonly mean: number;
  readonly stdDev: number;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
}

/**
 * Lo que el Predictor sabe de un procedimiento del catálogo maestro.
 * Refleja una fila de la tabla Procedure (sin clinicId — global).
 */
export interface ProcedureInfo {
  /** ID del procedimiento (string opaco; en DB es Int, se convierte aquí). */
  readonly procedureId: string;
  /** Distribución global de referencia, en minutos. */
  readonly referenceDistribution: ProcedureDistributions;
  /**
   * Fases clínicas ordenadas del procedimiento, si están documentadas.
   * La última fase indica que el procedimiento está prácticamente terminado.
   *
   * Si el catálogo no documenta fases, undefined → updateInProgress no
   * tiene información para comprimir y devolverá la distribución previa.
   */
  readonly orderedPhases?: ReadonlyArray<string>;
}

/**
 * Lo que el Predictor sabe de la activación clínica × procedimiento.
 * Refleja una fila de ProcedureActivation.
 */
export interface ProcedureActivationInfo {
  readonly procedureId: string;
  /** ID del tenant/clínica como string opaco. */
  readonly tenantId: string;
  /**
   * Distribución aprendida en esta clínica, en minutos.
   * Si null, el Predictor cae a referenceDistribution.
   *
   * Nota: en el cold start (Sesión 11B seed) learned = reference, así que
   * raramente será null. Pero la activación puede deshabilitarse o no existir.
   */
  readonly learnedDistribution: ProcedureDistributions | null;
}

/**
 * Scores predictivos de un paciente. Reflejan los 4 campos predictivos
 * añadidos a Patient en Sesión 11C. Cualquiera puede ser null (cold start
 * antes de que C1 los rellene con datos reales).
 */
export interface PatientPredictiveScores {
  readonly patientId: string;
  /** [0, 1]; null si nunca se ha computado. */
  readonly noShowScore: number | null;
  /** Minutos; null si nunca se ha computado. Mean libre (puede ser negativo). */
  readonly latenessMeanMinutes: number | null;
  /** Minutos; null si nunca se ha computado. Debe ser >= 0 si no es null. */
  readonly latenessStdDevMinutes: number | null;
  /** [0, 1]; null si nunca se ha computado. */
  readonly acceptAdviceScore: number | null;
}

/**
 * Contexto para predictDuration v1.
 *
 * v1 (esta sesión, sin ML): solo procedure × clinic. Ignora profesional,
 * paciente, hora del día, secuencia previa. Coherente con master §8
 * ("C1 Predictor sin ML en arranque").
 *
 * v2 (post-piloto, con ML): este tipo se extenderá con dentista, paciente,
 * hora, etc. La firma de predictDuration cambiará. Documentado.
 */
export interface DurationPredictionContext {
  readonly procedure: ProcedureInfo;
  readonly activation: ProcedureActivationInfo;
}

/**
 * Contexto para updateInProgress: la cita en curso + la fase completada.
 */
export interface InProgressContext {
  /** Distribución de duración previa (la que está vigente para la cita). */
  readonly previousDistribution: ProcedureDistributions;
  /** Información del procedimiento (incluye orderedPhases si están). */
  readonly procedure: ProcedureInfo;
  /** ID de la fase clínica que el evento marca como completada. */
  readonly completedPhase: string;
}
