/**
 * Scorer (C5) — Sesión 16.
 *
 * Quinto componente vivo del clean core. Implementa la API del Componente 5
 * según core-contract.md §6 y logica-reoptimizacion-saas.md §10:
 *
 *   score(simulationResult, action, options?) → ScoreResult
 *
 * Es donde vive la "personalidad" del motor para cada clínica: los pesos
 * de ScoreWeights deciden qué KPI prioriza el tenant, y los normalizadores
 * de ScoreNormalizers calibran la escala dimensional de cada KPI.
 *
 * Función pura. No accede a Prisma. Recibe SimulationResult (output de C4)
 * + CompositeAction + ScorerOptions.
 *
 * Decisión de diseño: la firma del documento de lógica es
 * score(simulationResult, weights, changeCost) — pero changeCost se calcula
 * INTERNAMENTE desde la action en v1, evitando que el Coordinator (C6)
 * tenga que conocer la heurística antes de llamar al Scorer. Si en el futuro
 * el coste de cambio se mide externamente (ej: telemetría real de avisos
 * fallidos), se inyecta vía ScorerOptions.changeCostCoefficients.
 *
 * Deuda blanda registrada (master v7.16+):
 *   - SCORER-NORMALIZERS-V1: defaults de DEFAULT_NORMALIZERS son razonables
 *     para clínica dental pequeña-media en España, no validados con datos
 *     reales. Refinar tras 1-3 pilotos.
 *   - SCORER-CHANGE-COST-HEURISTIC-V1: la fórmula counts × coefficients es
 *     una aproximación lineal. Algunas combinaciones (ej: 5 reasignaciones
 *     simultáneas en mismo profesional) tienen coste superlineal. Revisar
 *     post-piloto.
 */

import type {
  CompositeAction,
  KPIVector,
  PrimitiveAction,
  SimulationResult,
} from "./types";
import {
  DEFAULT_CHANGE_COST_COEFFICIENTS,
  DEFAULT_CHANGE_COST_PENALTY_WEIGHT,
  DEFAULT_NORMALIZERS,
  DEFAULT_RISK_PENALTY_WEIGHT,
  DEFAULT_WEIGHTS,
  InvalidWeightsError,
  validateWeights,
  type ChangeCostBreakdown,
  type ChangeCostCoefficients,
  type ScoreBreakdown,
  type ScoreNormalizers,
  type ScoreResult,
  type ScoreWeights,
  type ScorerOptions,
} from "./scorer-types";

// =============================================================================
// Helpers — normalización dimensional
// =============================================================================

/**
 * Lleva un valor crudo de un KPI al rango [0, 1] dividiendo por su
 * normalizador. Si el normalizador es 0 o el valor es negativo, devuelve 0
 * (defensivo: no debería ocurrir en práctica, pero evita NaN).
 */
function normalize(value: number, normalizer: number): number {
  if (normalizer <= 0) return 0;
  if (value <= 0) return 0;
  return Math.min(1, value / normalizer);
}

// =============================================================================
// Helpers — KPI scoring
// =============================================================================

/**
 * Calcula la contribución firmada de cada KPI al score total.
 *
 * Convención de signos:
 *   - "Buenos altos" → contribución positiva: effectiveUtilization,
 *     projectedBillableValue.
 *   - "Malos altos" → contribución negativa: expectedOvertime, meanWaitTime,
 *     expectedForcedCancellations.
 *
 * Cada KPI se normaliza primero a [0,1] vía ScoreNormalizers, después se
 * multiplica por su peso (positivo) y por el signo de su categoría.
 *
 * El campo `risk` del KPIVector NO se contabiliza aquí — vive en la
 * penalización por varianza separada.
 */
export function scoreKPIs(
  expectedKPIs: KPIVector,
  weights: ScoreWeights,
  normalizers: ScoreNormalizers,
): { readonly contributions: KPIVector; readonly subtotal: number } {
  const contributions: KPIVector = {
    effectiveUtilization:
      +1 *
      weights.effectiveUtilization *
      normalize(
        expectedKPIs.effectiveUtilization,
        normalizers.effectiveUtilization,
      ),
    expectedOvertime:
      -1 *
      weights.expectedOvertime *
      normalize(expectedKPIs.expectedOvertime, normalizers.expectedOvertime),
    meanWaitTime:
      -1 *
      weights.meanWaitTime *
      normalize(expectedKPIs.meanWaitTime, normalizers.meanWaitTime),
    expectedForcedCancellations:
      -1 *
      weights.expectedForcedCancellations *
      normalize(
        expectedKPIs.expectedForcedCancellations,
        normalizers.expectedForcedCancellations,
      ),
    projectedBillableValue:
      +1 *
      weights.projectedBillableValue *
      normalize(
        expectedKPIs.projectedBillableValue,
        normalizers.projectedBillableValue,
      ),
    risk: 0, // no contribuye al subtotal — vive en riskPenalty.
  };

  const subtotal =
    contributions.effectiveUtilization +
    contributions.expectedOvertime +
    contributions.meanWaitTime +
    contributions.expectedForcedCancellations +
    contributions.projectedBillableValue;

  return { contributions, subtotal };
}

// =============================================================================
// Helpers — coste de cambio
// =============================================================================

/**
 * Cuenta primitivas por categoría de coste y devuelve el desglose ponderado.
 *
 * Categorías (v1):
 *   - notifyPatient: postpone con notifyPatient=true.
 *   - reassignProfessional: reassign_professional.
 *   - reassignResource: reassign_resource.
 *   - otherPrimitive: move, advance, postpone sin notify, compress, expand,
 *     fill_from_waitlist, cancel_and_reschedule.
 *   - no_op no se cuenta (coste cero por definición).
 *
 * fill_from_waitlist se contabiliza como otherPrimitive en v1 — su coste
 * real depende de si se llama al paciente, lo cual no está modelado en la
 * acción primitiva. Refinable en v2.
 */
export function computeChangeCost(
  action: CompositeAction,
  coefficients: ChangeCostCoefficients,
): ChangeCostBreakdown {
  let notifyPatientCount = 0;
  let reassignProfessionalCount = 0;
  let reassignResourceCount = 0;
  let otherPrimitiveCount = 0;

  for (const prim of action) {
    if (countsAsNotifyPatient(prim)) {
      notifyPatientCount += 1;
    } else if (prim.kind === "reassign_professional") {
      reassignProfessionalCount += 1;
    } else if (prim.kind === "reassign_resource") {
      reassignResourceCount += 1;
    } else if (prim.kind === "no_op") {
      // sin coste.
    } else {
      otherPrimitiveCount += 1;
    }
  }

  const totalCost =
    notifyPatientCount * coefficients.notifyPatient +
    reassignProfessionalCount * coefficients.reassignProfessional +
    reassignResourceCount * coefficients.reassignResource +
    otherPrimitiveCount * coefficients.otherPrimitive;

  return {
    notifyPatientCount,
    reassignProfessionalCount,
    reassignResourceCount,
    otherPrimitiveCount,
    totalCost,
  };
}

function countsAsNotifyPatient(prim: PrimitiveAction): boolean {
  return prim.kind === "postpone" && prim.notifyPatient === true;
}

// =============================================================================
// API pública — score
// =============================================================================

/**
 * Combina los KPIs proyectados por C4 con pesos por tenant + penalizaciones
 * por varianza y coste de cambio. Devuelve un escalar comparable entre
 * candidatas + breakdown para construcción de Explanation por C6.
 *
 * Pasos:
 *  1. Validar pesos (suman 1.0 ± tolerancia). Lanza InvalidWeightsError si no.
 *  2. Normalizar cada KPI a [0,1] y ponderar.
 *  3. Subtotal de contribuciones de KPIs (firmado).
 *  4. Penalización por varianza: riskPenaltyWeight × varianceKPIs.risk.
 *  5. Penalización por coste de cambio: changeCostPenaltyWeight × totalCost.
 *  6. totalScore = subtotal - riskPenalty - changeCostPenalty.
 */
export function score(
  simulationResult: SimulationResult,
  action: CompositeAction,
  options: ScorerOptions = {},
): ScoreResult {
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const normalizers = options.normalizers ?? DEFAULT_NORMALIZERS;
  const coefficients =
    options.changeCostCoefficients ?? DEFAULT_CHANGE_COST_COEFFICIENTS;
  const riskPenaltyWeight =
    options.riskPenaltyWeight ?? DEFAULT_RISK_PENALTY_WEIGHT;
  const changeCostPenaltyWeight =
    options.changeCostPenaltyWeight ?? DEFAULT_CHANGE_COST_PENALTY_WEIGHT;

  // 1. Validar pesos.
  const weightCheck = validateWeights(weights);
  if (!weightCheck.valid) {
    throw new InvalidWeightsError(weightCheck.sum);
  }

  // 2-3. Contribución firmada de cada KPI + subtotal.
  const { contributions, subtotal } = scoreKPIs(
    simulationResult.expectedKPIs,
    weights,
    normalizers,
  );

  // 4. Penalización por varianza.
  // El campo risk de varianceKPIs ya viene calculado por C4 como norma
  // euclídea ponderada de las varianzas individuales.
  const riskPenalty = riskPenaltyWeight * simulationResult.varianceKPIs.risk;

  // 5. Penalización por coste de cambio.
  const changeCostBreakdown = computeChangeCost(action, coefficients);
  const changeCostPenalty =
    changeCostPenaltyWeight * changeCostBreakdown.totalCost;

  // 6. Score total.
  const totalScore = subtotal - riskPenalty - changeCostPenalty;

  const breakdown: ScoreBreakdown = {
    kpiContributions: contributions,
    kpiSubtotal: subtotal,
    riskPenalty,
    changeCostPenalty,
    changeCostBreakdown,
  };

  return { totalScore, breakdown };
}