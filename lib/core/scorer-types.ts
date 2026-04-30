/**
 * Tipos del Scorer (C5) — Sesión 16.
 *
 * El Scorer combina los KPIs proyectados por el Simulator (C4) con pesos
 * por tenant + penalizaciones por varianza y coste de cambio, devolviendo
 * un escalar comparable entre candidatas.
 *
 * Decisión de diseño Sesión 16:
 *   - score() devuelve ScoreResult (no number) para que el Coordinator (C6)
 *     pueda construir Explanation.discardReasonCode desde el breakdown.
 *   - Los normalizadores dimensionales son inyectables por tenant: rangos
 *     plausibles de cada KPI varían entre clínicas y se afinarán con datos
 *     reales tras el piloto. Defaults exportados para arranque.
 *   - ChangeCost se calcula INTERNAMENTE desde la CompositeAction. El caller
 *     pasa la acción, no un objeto pre-computado. Razón: evitar que el
 *     Coordinator tenga que conocer la heurística de coste antes de llamar
 *     al Scorer.
 */

import type { CompositeAction, KPIVector } from "./types";
import type { ScoreRatio } from "./primitives";

// =============================================================================
// Pesos
// =============================================================================

/**
 * Pesos por KPI. Suman 1.0 ± SUM_TOLERANCE. Invariante validada al construir
 * ScorerOptions vía validateWeights() (export más abajo).
 *
 * Convención de signos: TODOS los pesos son positivos. El score combina los
 * KPIs aplicando el signo apropiado internamente — KPIs "buenos altos"
 * (effectiveUtilization, projectedBillableValue) suman, KPIs "malos altos"
 * (expectedOvertime, meanWaitTime, expectedForcedCancellations) restan.
 */
export interface ScoreWeights {
  readonly effectiveUtilization: ScoreRatio;
  readonly expectedOvertime: ScoreRatio;
  readonly meanWaitTime: ScoreRatio;
  readonly expectedForcedCancellations: ScoreRatio;
  readonly projectedBillableValue: ScoreRatio;
}

/**
 * Defaults para clínica dental "típica" — afinables por tenant tras piloto.
 * Razonamiento:
 *   - projectedBillableValue (0.25): es el wedge comercial (€ recuperados).
 *   - effectiveUtilization (0.20): output operativo principal.
 *   - expectedOvertime (0.20): el dolor que el dueño verbaliza más fuerte.
 *   - expectedForcedCancellations (0.20): impacta NPS de la recepción.
 *   - meanWaitTime (0.15): importante pero secundario al resto.
 */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  effectiveUtilization: 0.2,
  expectedOvertime: 0.2,
  meanWaitTime: 0.15,
  expectedForcedCancellations: 0.2,
  projectedBillableValue: 0.25,
};

/** Tolerancia para la suma de pesos. Reutiliza I-3 (sum(weights) === 1.0 ± 0.001). */
export const WEIGHT_SUM_TOLERANCE = 0.001;

// =============================================================================
// Normalizadores dimensionales
// =============================================================================

/**
 * Rangos plausibles esperados por KPI, usados para llevar todos los KPIs
 * crudos a [0,1] antes de combinar linealmente. Sin esto, projectedBillableValue
 * (€) dominaría sobre effectiveUtilization (ratio) por escala dimensional.
 *
 * Cada normalizador define el rango "razonable" de su KPI:
 *   - effectiveUtilization: ya está en [0,1], rango = 1.
 *   - expectedOvertime: rango plausible 0..2h (en ms).
 *   - meanWaitTime: rango plausible 0..30min (en ms).
 *   - expectedForcedCancellations: 0..5 cancelaciones forzadas/día.
 *   - projectedBillableValue: 0..3000€ (jornada típica clínica pequeña-media).
 *
 * El score normalizado de cada KPI es min(1, raw / normalizer).
 */
export interface ScoreNormalizers {
  readonly effectiveUtilization: number;
  readonly expectedOvertime: number;
  readonly meanWaitTime: number;
  readonly expectedForcedCancellations: number;
  readonly projectedBillableValue: number;
}

/** Defaults para clínica dental típica. Afinables por tenant. */
export const DEFAULT_NORMALIZERS: ScoreNormalizers = {
  effectiveUtilization: 1,
  expectedOvertime: 2 * 60 * 60_000, // 2 horas en ms
  meanWaitTime: 30 * 60_000, // 30 minutos en ms
  expectedForcedCancellations: 5,
  projectedBillableValue: 3000,
};

// =============================================================================
// Coste de cambio
// =============================================================================

/**
 * Coeficientes que ponderan los componentes del coste de cambio. v1 modela
 * tres dimensiones: avisos a paciente (fricción humana), reasignaciones de
 * profesional (riesgo operativo), reasignaciones de recurso (menor coste).
 *
 * Defaults justificados:
 *   - notifyPatient (1.0): cada llamada a paciente cuesta tiempo de recepción.
 *   - reassignProfessional (0.8): genera fricción de comunicación interna.
 *   - reassignResource (0.3): coste bajo, normalmente automatizable.
 */
export interface ChangeCostCoefficients {
  readonly notifyPatient: number;
  readonly reassignProfessional: number;
  readonly reassignResource: number;
  /** Otras primitivas (move, advance, postpone sin notify, compress, expand). */
  readonly otherPrimitive: number;
}

export const DEFAULT_CHANGE_COST_COEFFICIENTS: ChangeCostCoefficients = {
  notifyPatient: 1.0,
  reassignProfessional: 0.8,
  reassignResource: 0.3,
  otherPrimitive: 0.2,
};

// =============================================================================
// Opciones del Scorer
// =============================================================================

export interface ScorerOptions {
  /** Defaults DEFAULT_WEIGHTS. */
  readonly weights?: ScoreWeights;
  /** Defaults DEFAULT_NORMALIZERS. */
  readonly normalizers?: ScoreNormalizers;
  /** Defaults DEFAULT_CHANGE_COST_COEFFICIENTS. */
  readonly changeCostCoefficients?: ChangeCostCoefficients;
  /** Peso global de la penalización por varianza. Default 0.1. */
  readonly riskPenaltyWeight?: number;
  /** Peso global de la penalización por coste de cambio. Default 0.05. */
  readonly changeCostPenaltyWeight?: number;
}

export const DEFAULT_RISK_PENALTY_WEIGHT = 0.1;
export const DEFAULT_CHANGE_COST_PENALTY_WEIGHT = 0.05;

// =============================================================================
// Output
// =============================================================================

/**
 * Desglose del score para construcción de Explanation y para tests.
 *
 * Convenciones:
 *   - kpiContributions: contribución firmada de cada KPI tras normalización
 *     y aplicación de signo (positivo si suma, negativo si resta).
 *   - kpiSubtotal: suma de kpiContributions.
 *   - riskPenalty: valor positivo restado.
 *   - changeCostPenalty: valor positivo restado.
 *   - changeCostBreakdown: cuántas primitivas de cada tipo había en la action.
 *   - totalScore: kpiSubtotal - riskPenalty - changeCostPenalty.
 *
 * Nota: totalScore puede caer fuera de [0,1] cuando las penalizaciones
 * superan al subtotal (composiciones malas). Es deliberado — el Coordinator
 * usa la magnitud para comparar candidatas, no para interpretarla como ratio.
 */
export interface ScoreBreakdown {
  readonly kpiContributions: KPIVector;
  readonly kpiSubtotal: number;
  readonly riskPenalty: number;
  readonly changeCostPenalty: number;
  readonly changeCostBreakdown: ChangeCostBreakdown;
}

export interface ChangeCostBreakdown {
  readonly notifyPatientCount: number;
  readonly reassignProfessionalCount: number;
  readonly reassignResourceCount: number;
  readonly otherPrimitiveCount: number;
  /** Suma ponderada de los counts por sus coeficientes. */
  readonly totalCost: number;
}

export interface ScoreResult {
  readonly totalScore: number;
  readonly breakdown: ScoreBreakdown;
}

// =============================================================================
// Validación de pesos (helper público)
// =============================================================================

/**
 * Valida que los pesos suman 1.0 ± WEIGHT_SUM_TOLERANCE. Invariante I-3
 * reutilizada del v1.0. Llamar desde el Scorer al inicio de score() y
 * desde tests para fixtures.
 */
export function validateWeights(weights: ScoreWeights): {
  readonly valid: boolean;
  readonly sum: number;
} {
  const sum =
    weights.effectiveUtilization +
    weights.expectedOvertime +
    weights.meanWaitTime +
    weights.expectedForcedCancellations +
    weights.projectedBillableValue;
  return {
    valid: Math.abs(sum - 1.0) <= WEIGHT_SUM_TOLERANCE,
    sum,
  };
}

export class InvalidWeightsError extends Error {
  constructor(public readonly sum: number) {
    super(
      `ScoreWeights must sum to 1.0 ± ${WEIGHT_SUM_TOLERANCE}, got ${sum}.`,
    );
    this.name = "InvalidWeightsError";
  }
}