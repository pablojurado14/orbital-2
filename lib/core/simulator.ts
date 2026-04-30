/**
 * Simulator (C4) — Sesión 15.
 *
 * Cuarto componente vivo del clean core. Implementa la API del Componente 4
 * según core-contract.md §6 y logica-reoptimizacion-saas.md §10:
 *
 *   simulate(state, action, context, options?) → SimulationResult
 *
 * Política Sesión 15 (master §6 + decisión rectora §8): implementación
 * DETERMINISTA. p50 + varianza analítica derivada de p10/p90 asumiendo
 * normalidad aproximada (Z=1.28 a cada lado, stdDev ≈ (p90 - p10) / 2.56).
 * Monte Carlo se difiere a sesión post-piloto cuando haya datos reales.
 *
 * Cobertura v1:
 *   - 6 KPIs: effectiveUtilization, expectedOvertime, meanWaitTime,
 *     expectedForcedCancellations, projectedBillableValue, risk.
 *   - 3 ProjectedEventKind: potential_overrun, potential_no_show,
 *     potential_late_arrival. potential_forced_cancellation diferido a
 *     Sesión 16 (requiere razonar sobre imposibilidad de fitting downstream).
 *   - 2 CriticalPointKind: professional_overtime_starts, equipment_conflict.
 *     Los otros 3 (overrun_starts_propagating, wait_threshold_exceeded,
 *     patient_tolerance_breached) requieren modelado adicional, diferidos.
 *
 * Función pura. No accede a Prisma. Recibe DayState + SimulationContext +
 * options. Aplica la CompositeAction al estado vía applyComposite y proyecta
 * sobre el estado resultante.
 *
 * Deuda blanda registrada (master v7.16):
 *   - SIMULATOR-VARIANCE-GAUSSIAN-ASSUMPTION: la fórmula stdDev ≈ (p90-p10)/2.56
 *     asume normalidad. Distribuciones de duración clínica son típicamente
 *     sesgadas a la derecha (cola larga por overruns). Revisar post-piloto
 *     con datos reales.
 *   - MEAN_WAIT_TIME_HEURISTIC_V1: heurística cascade (cita N-1 desborda →
 *     cita N espera) en lugar de wait real desde check-in. Refinar cuando
 *     modelemos timestamps de check_in / in_progress en runtime.
 *   - ESTIMATED_END_DISTRIBUTION_SEMANTICS_DRIFT: types.ts comenta que es
 *     instant absoluto pero state-transitions la trata como duración.
 *     Resolver en Sesión 18.
 *   - SIMULATOR-WORKDAY-WINDOWS-V1: la jornada laboral se modela como
 *     mañana + tarde, sumadas. Si en el futuro hay clínicas con turnos
 *     más complejos (3+ ventanas, descansos parciales), generalizar.
 */

import type {
  AppointmentState,
  CompositeAction,
  CriticalPoint,
  DayState,
  DurationDistribution,
  KPIVector,
  ProjectedEvent,
  SimulationResult,
} from "./types";
import type {
  DurationMs,
  EventId,
  InstantUTC,
  MonetaryAmount,
  ResourceId,
  ScoreRatio,
} from "./primitives";
import {
  applyComposite,
  type AppointmentRuntime,
  type AppointmentRuntimeMap,
} from "./state-transitions";
import {
  instantToDayAndMinutes,
  parseHHMM,
  type ProfessionalCapabilities,
  type WorkSchedule,
} from "./domain-types";
import {
  DEFAULT_LATE_ARRIVAL_PROB_THRESHOLD,
  DEFAULT_NO_SHOW_PROB_THRESHOLD,
  DEFAULT_OVERRUN_PROB_THRESHOLD,
  type SimulationContext,
  type SimulationOptions,
} from "./simulator-types";

// =============================================================================
// Constantes
// =============================================================================

/**
 * Factor para derivar stdDev de (p90 - p10) asumiendo normalidad:
 * en N(μ, σ²), p90 - p10 = 2 * 1.2816 * σ ≈ 2.5631 * σ.
 * Z=1.2816 corresponde al percentil 90.
 */
const P90_MINUS_P10_TO_STDDEV = 2.5631;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

// =============================================================================
// Helpers internos — temporales y geométricos
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

function isAppointmentLive(a: AppointmentState): boolean {
  return a.runtimeStatus !== "cancelled" && a.runtimeStatus !== "no_show";
}

/**
 * Devuelve el instante (ms UTC) en el que termina la jornada laboral del
 * profesional para el día de `dayInstant`. Si el profesional trabaja
 * mañana+tarde, devuelve el final de la tarde. Si solo trabaja mañana,
 * devuelve el final de la mañana. Si no trabaja ese día (o no tiene
 * workSchedule), devuelve null.
 */
function endOfWorkDayMs(
  schedule: WorkSchedule | null,
  dayInstant: InstantUTC,
): InstantUTC | null {
  if (schedule === null) return null;
  const info = instantToDayAndMinutes(dayInstant);
  const day = schedule[String(info.dayOfWeek)];
  if (day === undefined) return null;

  // Preferimos afternoonClose si existe.
  let endMin: number | null = null;
  if (day.afternoonClose !== undefined) {
    endMin = parseHHMM(day.afternoonClose);
  } else if (day.morningClose !== undefined) {
    endMin = parseHHMM(day.morningClose);
  }
  if (endMin === null) return null;

  // Reconstruir el instante: medianoche del día + endMin minutos en UTC.
  const midnight = dayInstant - info.minutesOfDay * MS_PER_MINUTE;
  return midnight + endMin * MS_PER_MINUTE;
}

/**
 * Duración total de la jornada laboral del profesional para el día de
 * `dayInstant`, sumando ventana de mañana + ventana de tarde por separado.
 *
 * IMPORTANTE: NO usar (endOfWorkDayMs - startOfWorkDayMs) — esa diferencia
 * incluiría la pausa para comer entre morningClose y afternoonOpen como
 * tiempo "disponible", lo que sobreestima el denominador de la utilización.
 *
 * Si el profesional no tiene workSchedule documentado o no trabaja ese día,
 * devuelve 0.
 */
function workDayDurationMs(
  schedule: WorkSchedule | null,
  dayInstant: InstantUTC,
): DurationMs {
  if (schedule === null) return 0;
  const info = instantToDayAndMinutes(dayInstant);
  const day = schedule[String(info.dayOfWeek)];
  if (day === undefined) return 0;

  let total = 0;

  if (day.morningOpen !== undefined && day.morningClose !== undefined) {
    const open = parseHHMM(day.morningOpen);
    const close = parseHHMM(day.morningClose);
    if (open !== null && close !== null && close > open) {
      total += (close - open) * MS_PER_MINUTE;
    }
  }

  if (day.afternoonOpen !== undefined && day.afternoonClose !== undefined) {
    const open = parseHHMM(day.afternoonOpen);
    const close = parseHHMM(day.afternoonClose);
    if (open !== null && close !== null && close > open) {
      total += (close - open) * MS_PER_MINUTE;
    }
  }

  return total;
}

// =============================================================================
// Helpers internos — varianza analítica
// =============================================================================

/**
 * Deriva stdDev (en ms) desde una DurationDistribution usando la asunción
 * gaussiana documentada en SIMULATOR-VARIANCE-GAUSSIAN-ASSUMPTION.
 *
 * Si stdDev ya viene poblada en la distribución (>0), la respeta — el
 * Predictor pudo haber calculado una stdDev más fina que la aproximación
 * desde percentiles.
 */
export function stdDevFromDistribution(d: DurationDistribution): number {
  if (d.stdDev > 0) return d.stdDev;
  const spread = d.p90 - d.p10;
  if (spread <= 0) return 0;
  return spread / P90_MINUS_P10_TO_STDDEV;
}

/**
 * Varianza estimada (en ms²) a partir de una DurationDistribution.
 */
export function varianceFromDistribution(d: DurationDistribution): number {
  const s = stdDevFromDistribution(d);
  return s * s;
}

// =============================================================================
// Helpers de KPIs — cada uno funcional puro y testeable individualmente
// =============================================================================

/**
 * effectiveUtilization: fracción [0,1] del tiempo total disponible de
 * profesionales (suma de jornadas, mañana + tarde por separado) ocupada por
 * appointments vivos (planned, no canceladas/no_show).
 *
 * Si la suma de jornadas disponibles es 0 (sin profesionales con schedule
 * o ningún schedule cubre el día), devuelve 0.
 */
export function computeEffectiveUtilization(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  professionals: ReadonlyArray<ProfessionalCapabilities>,
): ScoreRatio {
  // Tiempo disponible total: suma de duración de jornada por profesional,
  // contabilizando solo ventanas activas (no la pausa de comer).
  let totalAvailableMs = 0;
  for (const prof of professionals) {
    totalAvailableMs += workDayDurationMs(prof.workSchedule, state.date);
  }

  if (totalAvailableMs <= 0) return 0;

  // Tiempo planeado ocupado: suma de plannedDuration de citas vivas.
  let totalPlannedMs = 0;
  const liveIds = new Set(
    state.appointments.filter(isAppointmentLive).map((a) => a.eventId),
  );
  for (const eventId of Object.keys(runtimes)) {
    if (!liveIds.has(eventId)) continue;
    totalPlannedMs += runtimes[eventId].plannedDuration;
  }

  return Math.min(1, totalPlannedMs / totalAvailableMs);
}

/**
 * expectedOvertime (ms): suma sobre todos los profesionales del exceso del
 * fin del último appointment del día sobre el final de su jornada.
 *
 * Profesionales sin workSchedule documentado contribuyen 0 (consistente
 * con el patrón del Validator: sin info, no se viola).
 */
export function computeExpectedOvertime(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  professionals: ReadonlyArray<ProfessionalCapabilities>,
): DurationMs {
  const liveIds = new Set(
    state.appointments.filter(isAppointmentLive).map((a) => a.eventId),
  );

  // Indexar runtimes por professionalId.
  const byProf = new Map<ResourceId, AppointmentRuntime[]>();
  for (const eventId of Object.keys(runtimes)) {
    if (!liveIds.has(eventId)) continue;
    const r = runtimes[eventId];
    const list = byProf.get(r.professionalId) ?? [];
    list.push(r);
    byProf.set(r.professionalId, list);
  }

  let totalOvertime = 0;
  for (const prof of professionals) {
    const eod = endOfWorkDayMs(prof.workSchedule, state.date);
    if (eod === null) continue;
    const apts = byProf.get(prof.professionalId);
    if (apts === undefined || apts.length === 0) continue;

    let lastEnd = 0;
    for (const r of apts) {
      const end = r.start + r.plannedDuration;
      if (end > lastEnd) lastEnd = end;
    }
    totalOvertime += Math.max(0, lastEnd - eod);
  }

  return totalOvertime;
}

/**
 * meanWaitTime (ms): heurística cascade documentada como
 * MEAN_WAIT_TIME_HEURISTIC_V1.
 *
 * Para cada profesional, ordenamos sus citas vivas por start ascendente.
 * Por cada cita N (N >= 1), calculamos:
 *   end_estimado_N-1 = start_N-1 + p50(estimatedEndDistribution_N-1)
 *   wait_N = max(0, end_estimado_N-1 - start_N)
 *
 * Promedio sobre todas las citas que tienen una predecesora del mismo
 * profesional. Si no hay tales pares, devuelve 0.
 */
export function computeMeanWaitTime(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
): DurationMs {
  const liveAppointments = state.appointments.filter(isAppointmentLive);
  const distById = new Map<EventId, DurationDistribution>();
  for (const a of liveAppointments) {
    distById.set(a.eventId, a.estimatedEndDistribution);
  }

  // Indexar runtimes por professionalId, ordenados por start ascendente.
  const byProf = new Map<ResourceId, AppointmentRuntime[]>();
  for (const a of liveAppointments) {
    const r = runtimes[a.eventId];
    if (r === undefined) continue;
    const list = byProf.get(r.professionalId) ?? [];
    list.push(r);
    byProf.set(r.professionalId, list);
  }
  for (const list of byProf.values()) {
    list.sort((a, b) => a.start - b.start);
  }

  let totalWait = 0;
  let pairs = 0;
  for (const list of byProf.values()) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const curr = list[i];
      const prevDist = distById.get(prev.eventId);
      if (prevDist === undefined) continue;
      const prevExpectedEnd = prev.start + prevDist.p50;
      const wait = Math.max(0, prevExpectedEnd - curr.start);
      totalWait += wait;
      pairs += 1;
    }
  }

  if (pairs === 0) return 0;
  return totalWait / pairs;
}

/**
 * expectedForcedCancellations (número esperado): suma de probabilidades de
 * no-show + suma ponderada de probabilidades de overrun severo (> 50%) que
 * cascadean a cita downstream.
 *
 * v1: contamos noShowProbability tal cual, y por cada cita con overrun
 * severo (>0.5) que tenga downstream del mismo profesional, sumamos
 * overrunProbability * 0.5 (factor de "probabilidad de que el cascade
 * cause cancelación forzada de la última cita del día"). Heurística
 * conservadora que se afinará con datos reales.
 */
export function computeExpectedForcedCancellations(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
): number {
  const liveAppointments = state.appointments.filter(isAppointmentLive);

  // Indexar runtimes por professionalId, ordenados por start.
  const byProf = new Map<ResourceId, AppointmentRuntime[]>();
  for (const a of liveAppointments) {
    const r = runtimes[a.eventId];
    if (r === undefined) continue;
    const list = byProf.get(r.professionalId) ?? [];
    list.push(r);
    byProf.set(r.professionalId, list);
  }
  for (const list of byProf.values()) {
    list.sort((a, b) => a.start - b.start);
  }

  // Riesgos por eventId.
  const risksById = new Map<EventId, AppointmentState>();
  for (const a of liveAppointments) {
    risksById.set(a.eventId, a);
  }

  let total = 0;
  for (const a of liveAppointments) {
    total += a.detectedRisks.noShowProbability;
  }

  // Cascade: por cita con overrunProbability > 0.5 y al menos un downstream.
  for (const list of byProf.values()) {
    for (let i = 0; i < list.length - 1; i++) {
      const apt = risksById.get(list[i].eventId);
      if (apt === undefined) continue;
      if (apt.detectedRisks.overrunProbability > 0.5) {
        total += apt.detectedRisks.overrunProbability * 0.5;
      }
    }
  }

  return total;
}

/**
 * projectedBillableValue: suma de price * (1 - noShowProbability) sobre
 * appointments vivos. Si el procedureId del runtime no aparece en
 * priceByProcedureId, contribuye 0 (procedimiento sin activación de
 * precio en el tenant).
 */
export function computeProjectedBillableValue(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  priceByProcedureId: Readonly<Record<ResourceId, MonetaryAmount>>,
): MonetaryAmount {
  let total = 0;
  const liveAppointments = state.appointments.filter(isAppointmentLive);
  for (const a of liveAppointments) {
    const r = runtimes[a.eventId];
    if (r === undefined) continue;
    const price = priceByProcedureId[r.procedureId];
    if (price === undefined) continue;
    const noShow = a.detectedRisks.noShowProbability;
    total += price * (1 - noShow);
  }
  return total;
}

// =============================================================================
// Helpers de varianza por KPI
// =============================================================================

/**
 * Para un KPI tipo "suma de duraciones" (overtime, waitTime), la varianza
 * de la suma de variables aleatorias independientes es la suma de varianzas.
 * Esta función devuelve la varianza agregada en ms².
 *
 * Para v1 asumimos independencia entre las distribuciones de cada
 * appointment, lo cual es una simplificación (los overruns están
 * correlacionados por profesional, hora, paciente). Registrado
 * implícitamente bajo SIMULATOR-VARIANCE-GAUSSIAN-ASSUMPTION.
 */
function aggregateVarianceMs2(state: DayState): number {
  let total = 0;
  for (const a of state.appointments) {
    if (!isAppointmentLive(a)) continue;
    total += varianceFromDistribution(a.estimatedEndDistribution);
  }
  return total;
}

/**
 * Varianza del projectedBillableValue: para cada cita con price p,
 * la varianza del término p * (1 - noShowProb) tratando noShowProb como
 * Bernoulli es p² * noShowProb * (1 - noShowProb). Suma sobre citas vivas.
 */
function projectedBillableValueVariance(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  priceByProcedureId: Readonly<Record<ResourceId, MonetaryAmount>>,
): number {
  let total = 0;
  const liveAppointments = state.appointments.filter(isAppointmentLive);
  for (const a of liveAppointments) {
    const r = runtimes[a.eventId];
    if (r === undefined) continue;
    const price = priceByProcedureId[r.procedureId];
    if (price === undefined) continue;
    const p = a.detectedRisks.noShowProbability;
    total += price * price * p * (1 - p);
  }
  return total;
}

/**
 * Varianza de expectedForcedCancellations: tratando cada noShow como
 * Bernoulli independiente, var = sum(p_i * (1 - p_i)).
 */
function expectedForcedCancellationsVariance(state: DayState): number {
  let total = 0;
  for (const a of state.appointments) {
    if (!isAppointmentLive(a)) continue;
    const p = a.detectedRisks.noShowProbability;
    total += p * (1 - p);
  }
  return total;
}

/**
 * computeRisk: norma euclídea de las varianzas de los KPIs no-risk del
 * vector. Cada KPI se normaliza por una escala dimensional para evitar
 * que projectedBillableValue (€²) domine sobre los demás (ms² o adimensional).
 *
 * v1: pesos uniformes tras normalización. Sesión 16 (Scorer) puede inyectar
 * pesos por tenant.
 */
export function computeRisk(
  varianceVectorRaw: Omit<KPIVector, "risk">,
): number {
  // Normalizadores dimensionales (rangos plausibles al cuadrado).
  // effectiveUtilization en [0,1] → varianza ya en [0, 0.25].
  // expectedOvertime: varianza típica del orden de (30 min)² = 3.24e12 ms².
  // meanWaitTime: similar al overtime.
  // expectedForcedCancellations: varianza ~ N (citas) * 0.25 → escala ~10.
  // projectedBillableValue: varianza ~ (200€)² = 40000 €².
  const normalizers = {
    effectiveUtilization: 1,
    expectedOvertime: 30 * MS_PER_MINUTE * 30 * MS_PER_MINUTE,
    meanWaitTime: 30 * MS_PER_MINUTE * 30 * MS_PER_MINUTE,
    expectedForcedCancellations: 10,
    projectedBillableValue: 40000,
  };

  const sumSquares =
    Math.pow(varianceVectorRaw.effectiveUtilization / normalizers.effectiveUtilization, 2) +
    Math.pow(varianceVectorRaw.expectedOvertime / normalizers.expectedOvertime, 2) +
    Math.pow(varianceVectorRaw.meanWaitTime / normalizers.meanWaitTime, 2) +
    Math.pow(varianceVectorRaw.expectedForcedCancellations / normalizers.expectedForcedCancellations, 2) +
    Math.pow(varianceVectorRaw.projectedBillableValue / normalizers.projectedBillableValue, 2);

  return Math.sqrt(sumSquares);
}

// =============================================================================
// Helpers — eventos proyectados
// =============================================================================

function buildProjectedEvents(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  thresholds: {
    overrun: number;
    noShow: number;
    lateArrival: number;
  },
): ReadonlyArray<ProjectedEvent> {
  const events: ProjectedEvent[] = [];
  for (const a of state.appointments) {
    if (!isAppointmentLive(a)) continue;
    const r = runtimes[a.eventId];
    if (r === undefined) continue;

    if (a.detectedRisks.overrunProbability > thresholds.overrun) {
      events.push({
        kind: "potential_overrun",
        affectedEventId: a.eventId,
        probability: a.detectedRisks.overrunProbability,
        expectedAt: r.start + r.plannedDuration,
      });
    }
    if (a.detectedRisks.noShowProbability > thresholds.noShow) {
      events.push({
        kind: "potential_no_show",
        affectedEventId: a.eventId,
        probability: a.detectedRisks.noShowProbability,
        expectedAt: r.start,
      });
    }
    if (
      a.detectedRisks.significantLatenessProbability > thresholds.lateArrival
    ) {
      events.push({
        kind: "potential_late_arrival",
        affectedEventId: a.eventId,
        probability: a.detectedRisks.significantLatenessProbability,
        expectedAt: r.start,
      });
    }
  }
  return events;
}

// =============================================================================
// Helpers — puntos críticos
// =============================================================================

function buildCriticalPoints(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  professionals: ReadonlyArray<ProfessionalCapabilities>,
): ReadonlyArray<CriticalPoint> {
  const points: CriticalPoint[] = [];
  const liveIds = new Set(
    state.appointments.filter(isAppointmentLive).map((a) => a.eventId),
  );

  // 1. professional_overtime_starts: por profesional, si el último
  //    appointment termina después del fin de jornada.
  const byProf = new Map<ResourceId, AppointmentRuntime[]>();
  for (const eventId of Object.keys(runtimes)) {
    if (!liveIds.has(eventId)) continue;
    const r = runtimes[eventId];
    const list = byProf.get(r.professionalId) ?? [];
    list.push(r);
    byProf.set(r.professionalId, list);
  }

  for (const prof of professionals) {
    const eod = endOfWorkDayMs(prof.workSchedule, state.date);
    if (eod === null) continue;
    const apts = byProf.get(prof.professionalId);
    if (apts === undefined || apts.length === 0) continue;

    const lastEnd = Math.max(...apts.map((r) => r.start + r.plannedDuration));
    if (lastEnd > eod) {
      points.push({
        instant: eod,
        kind: "professional_overtime_starts",
        affectedEventIds: apts
          .filter((r) => r.start + r.plannedDuration > eod)
          .map((r) => r.eventId),
      });
    }
  }

  // 2. equipment_conflict: pares de reservas del mismo equipmentId con
  //    intervalos solapados.
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
      if (
        !intervalsOverlap(
          { start: a.fromMs, end: a.toMs },
          { start: b.fromMs, end: b.toMs },
        )
      )
        continue;
      points.push({
        instant: Math.max(a.fromMs, b.fromMs),
        kind: "equipment_conflict",
        affectedEventIds: [a.eventId, b.eventId],
      });
    }
  }

  // Ordenar por instant ascendente para output determinista.
  points.sort((a, b) => a.instant - b.instant);
  return points;
}

// =============================================================================
// API pública — simulate
// =============================================================================

/**
 * Simula una CompositeAction aplicada al estado y proyecta KPIs + eventos +
 * puntos críticos.
 *
 * Pasos:
 *  1. Aplica la acción al estado (state-transitions.applyComposite).
 *  2. Calcula expectedKPIs sobre el estado resultante.
 *  3. Calcula varianceKPIs sobre el estado resultante.
 *  4. Calcula risk a partir del vector de varianzas (invariante I-12).
 *  5. Construye projectedEvents y criticalPoints.
 *
 * Función pura. Si la acción incluye una primitiva no soportada por
 * applyComposite, la excepción se propaga (igual que en validate).
 */
export function simulate(
  state: DayState,
  action: CompositeAction,
  context: SimulationContext,
  options: SimulationOptions = {},
): SimulationResult {
  const applied = applyComposite(
    state,
    context.runtimes,
    action,
    options.applyOptions,
  );

  // KPIs esperados (medianas / valores p50).
  const expectedKPIs: KPIVector = {
    effectiveUtilization: computeEffectiveUtilization(
      applied.state,
      applied.runtimes,
      context.professionals,
    ),
    expectedOvertime: computeExpectedOvertime(
      applied.state,
      applied.runtimes,
      context.professionals,
    ),
    meanWaitTime: computeMeanWaitTime(applied.state, applied.runtimes),
    expectedForcedCancellations: computeExpectedForcedCancellations(
      applied.state,
      applied.runtimes,
    ),
    projectedBillableValue: computeProjectedBillableValue(
      applied.state,
      applied.runtimes,
      context.priceByProcedureId,
    ),
    risk: 0, // se rellena tras calcular varianceKPIs.
  };

  // Varianza analítica por KPI.
  const aggregateMs2 = aggregateVarianceMs2(applied.state);
  const varianceKPIsRaw: Omit<KPIVector, "risk"> = {
    effectiveUtilization: 0,
    expectedOvertime: aggregateMs2,
    meanWaitTime: aggregateMs2,
    expectedForcedCancellations: expectedForcedCancellationsVariance(
      applied.state,
    ),
    projectedBillableValue: projectedBillableValueVariance(
      applied.state,
      applied.runtimes,
      context.priceByProcedureId,
    ),
  };

  const risk = computeRisk(varianceKPIsRaw);
  const varianceKPIs: KPIVector = {
    ...varianceKPIsRaw,
    risk, // misma magnitud — la varianza del riesgo es el riesgo mismo en v1.
  };

  const expectedKPIsWithRisk: KPIVector = {
    ...expectedKPIs,
    risk,
  };

  const thresholds = {
    overrun:
      options.overrunProbabilityThreshold ?? DEFAULT_OVERRUN_PROB_THRESHOLD,
    noShow:
      options.noShowProbabilityThreshold ?? DEFAULT_NO_SHOW_PROB_THRESHOLD,
    lateArrival:
      options.lateArrivalProbabilityThreshold ??
      DEFAULT_LATE_ARRIVAL_PROB_THRESHOLD,
  };

  const projectedEvents = buildProjectedEvents(
    applied.state,
    applied.runtimes,
    thresholds,
  );
  const criticalPoints = buildCriticalPoints(
    applied.state,
    applied.runtimes,
    context.professionals,
  );

  return {
    expectedKPIs: expectedKPIsWithRisk,
    varianceKPIs,
    projectedEvents,
    criticalPoints,
  };
}

// =============================================================================
// Re-exports para tests
// =============================================================================

export const SIMULATOR_INTERNALS = {
  P90_MINUS_P10_TO_STDDEV,
  MS_PER_MINUTE,
  MS_PER_HOUR,
  MS_PER_DAY,
};