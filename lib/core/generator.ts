/**
 * Generator (C3) — Sesión 14.
 *
 * Tercer componente vivo del clean core. Implementa la API del Componente 3
 * según core-contract.md §6 y logica-reoptimizacion-saas.md §10:
 *
 *   generateCandidates(state, runtimes, trigger, ctx, options?) → ReadonlyArray<CompositeAction>
 *
 * Política de Sesión 14: búsqueda local greedy con heurísticas de ranking
 * pre-scoring por trigger. Sin GA, sin MCTS. Anytime modelado como límite
 * de iteraciones (heurística constante por ms).
 *
 * Invariantes:
 *  - I-13 (contrato §12.2): no_op SIEMPRE presente como candidata.
 *  - Todas las candidatas devueltas son válidas según C2 (Validator).
 *
 * 5 triggers cubiertos:
 *  - gap_detected:              fill_from_waitlist por candidato viable.
 *  - no_show:                   sintetiza un Gap y reusa generateForGap.
 *  - overrun_propagation:       postpone / compress sobre cita causante.
 *  - professional_unavailable:  reassign_professional sobre cada cita afectada.
 *  - proactive_sweep:           v1 mínimo (no genera nada útil aún).
 *
 * Diferidas (no producidas por v1):
 *  - cancel_and_reschedule (es de "último recurso", no aparece en candidatas).
 *  - composiciones multi-evento complejas.
 */

import type {
  CompositeAction,
  DayState,
  Gap,
  WaitingCandidate,
  AppointmentState,
  PrimitiveAction,
} from "./types";
import type { EventId, ResourceId, DurationMs } from "./primitives";
import { validate } from "./validator";
import {
  applyComposite,
  type AppointmentRuntimeMap,
  type AppointmentRuntime,
  type FillFromWaitlistContext,
} from "./state-transitions";
import type {
  GenerationTrigger,
  GenerationContext,
  GenerationOptions,
  GapDetectedTrigger,
  OverrunPropagationTrigger,
  NoShowTrigger,
  ProfessionalUnavailableTrigger,
} from "./generator-types";

// =============================================================================
// Constantes
// =============================================================================

const DEFAULT_MAX_CANDIDATES_PER_TRIGGER = 20;
const DEFAULT_BUDGET_MS = 1000;
const ITERATIONS_PER_MS = 100; // heurística v1; no usado críticamente todavía

const NO_OP: CompositeAction = [{ kind: "no_op" }];

// Tolerancia para considerar "fit" en gap_detected: el candidato debe
// poder caber en el gap (desiredDuration <= gap.duration).

// =============================================================================
// Helpers comunes
// =============================================================================

function effectiveMaxCandidates(opts?: GenerationOptions): number {
  return opts?.maxCandidates ?? DEFAULT_MAX_CANDIDATES_PER_TRIGGER;
}

function findRuntime(
  runtimes: AppointmentRuntimeMap,
  eventId: EventId,
): AppointmentRuntime | null {
  return runtimes[eventId] ?? null;
}

function listProfessionalsCompatibleForCandidate(
  candidate: WaitingCandidate,
  ctx: GenerationContext,
): ReadonlyArray<ResourceId> {
  // En v1 no tenemos un mapeo waiting_candidate → procedure firme.
  // Heurística: usar todos los profesionales del contexto sin filtro.
  // Cuando WaitlistEntry esté plenamente integrado con desiredProcedureId
  // (Sesión 18), aquí se llamará a listCompatible().
  void candidate;
  return ctx.validation.professionals.map((p) => p.professionalId);
}

function listProfessionalsCompatibleForRuntime(
  runtime: AppointmentRuntime,
  ctx: GenerationContext,
): ReadonlyArray<ResourceId> {
  const reqs = ctx.validation.proceduresById[runtime.procedureId];
  if (reqs === undefined) {
    return ctx.validation.professionals.map((p) => p.professionalId);
  }
  const required = reqs.requiresProfessionalCapabilities;
  return ctx.validation.professionals
    .filter((p) =>
      required.every((cap) => (p.capabilities[cap] ?? 0) > 0),
    )
    .map((p) => p.professionalId);
}

function buildFillFromWaitlistContext(
  candidates: ReadonlyArray<WaitingCandidate>,
  professionalForCandidate: (c: WaitingCandidate) => ResourceId | null,
  ctx: GenerationContext,
): FillFromWaitlistContext {
  return {
    waitingCandidates: candidates,
    resolveProfessional: professionalForCandidate,
    buildEstimatedDistribution: (candidate) => {
      const procedureId = candidate.externalRefs?.procedureId;
      if (
        procedureId !== undefined &&
        ctx.estimatedDistributionByProcedureId?.[procedureId] !== undefined
      ) {
        return ctx.estimatedDistributionByProcedureId[procedureId];
      }
      // Fallback: distribución degenerada del proposed duration.
      return {
        mean: candidate.desiredDuration,
        stdDev: 0,
        p10: candidate.desiredDuration,
        p50: candidate.desiredDuration,
        p90: candidate.desiredDuration,
      };
    },
  };
}

/**
 * Filtra candidatas dejando solo las válidas según C2.
 * Para fill_from_waitlist necesitamos pasar el contexto al validate vía
 * applyComposite que C2 ejecuta internamente. Por eso este helper acepta
 * un fillCtx opcional.
 */
function keepValid(
  candidates: ReadonlyArray<CompositeAction>,
  state: DayState,
  ctx: GenerationContext,
  fillCtx?: FillFromWaitlistContext,
): ReadonlyArray<CompositeAction> {
  const valid: CompositeAction[] = [];
  const opts =
    fillCtx !== undefined ? { fillFromWaitlist: fillCtx } : undefined;
  for (const candidate of candidates) {
    try {
      const result = validate(state, candidate, ctx.validation, opts);
      if (result.valid) valid.push(candidate);
    } catch {
      // Excepción al aplicar/validar → candidata inválida, descartamos.
    }
  }
  return valid;
}

function containsFillFromWaitlist(action: CompositeAction): boolean {
  return action.some((p) => p.kind === "fill_from_waitlist");
}

function takeTopN<T>(
  items: ReadonlyArray<T>,
  n: number,
  scoreFn: (item: T) => number,
): ReadonlyArray<T> {
  const scored = items.map((item) => ({ item, score: scoreFn(item) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((s) => s.item);
}

// =============================================================================
// Generadores específicos por trigger
// =============================================================================

/**
 * gap_detected: para cada candidato de waitlist viable (desiredDuration <= gap),
 * generar una CompositeAction con un fill_from_waitlist.
 *
 * Ranking heurístico: value × (priority + 0.1) × (easeScore + 0.1) — proxy del
 * valor recuperable. Top-N por ese ranking se valida con C2.
 */
function generateForGap(
  state: DayState,
  trigger: GapDetectedTrigger,
  ctx: GenerationContext,
  maxCandidates: number,
): ReadonlyArray<CompositeAction> {
  const gap = trigger.gap;
  const viable = ctx.waitlist.candidates.filter(
    (c) => c.desiredDuration <= gap.duration,
  );
  if (viable.length === 0) return [];

  // Ranking pre-scoring
  const top = takeTopN(viable, maxCandidates, (c) =>
    c.value * (c.priority + 0.1) * (c.easeScore + 0.1),
  );

  // Resolver profesional para cada candidato (primer compatible)
  const professionalForCandidate = (cand: WaitingCandidate): ResourceId | null => {
    const compat = listProfessionalsCompatibleForCandidate(cand, ctx);
    return compat[0] ?? null;
  };

  const fillCtx = buildFillFromWaitlistContext(top, professionalForCandidate, ctx);

  const candidates: CompositeAction[] = top.map((c) => [
    {
      kind: "fill_from_waitlist",
      waitingCandidateId: c.id,
      gapStart: gap.start,
      gapResourceId: gap.resourceId,
      proposedDuration: c.desiredDuration,
    },
  ]);

  return keepValid(candidates, state, ctx, fillCtx);
}

/**
 * no_show: el slot del paciente que no apareció es funcionalmente un gap.
 * Construimos un Gap sintético con originEventId = eventId del no-show
 * y reusamos generateForGap.
 */
function generateForNoShow(
  state: DayState,
  trigger: NoShowTrigger,
  ctx: GenerationContext,
  maxCandidates: number,
): ReadonlyArray<CompositeAction> {
  const runtime = findRuntime(ctx.validation.runtimes, trigger.eventId);
  if (runtime === null) return [];

  const gap: Gap = {
    resourceId: runtime.roomId,
    start: runtime.start,
    duration: runtime.plannedDuration,
    originEventId: trigger.eventId,
  };
  return generateForGap(
    state,
    { kind: "gap_detected", gap },
    ctx,
    maxCandidates,
  );
}

/**
 * overrun_propagation: la cita originEventId se está alargando
 * estimatedSlippage. Proponemos:
 *  - postpone sobre cada cita downstream (avisar paciente que llegue X tarde).
 *  - compress sobre la cita causante (acortar lo que queda).
 *
 * Heurística: priorizar candidatas con menor disrupción (postpone más cortos
 * primero). Si no hay downstream afectado, vuelve solo compress.
 */
function generateForOverrun(
  state: DayState,
  trigger: OverrunPropagationTrigger,
  ctx: GenerationContext,
  maxCandidates: number,
): ReadonlyArray<CompositeAction> {
  const candidates: CompositeAction[] = [];

  // Postpone candidates: una candidata por cita downstream
  for (const downstreamId of trigger.affectedDownstreamEventIds) {
    const r = findRuntime(ctx.validation.runtimes, downstreamId);
    if (r === null) continue;
    const newStart = r.start + trigger.estimatedSlippage;
    candidates.push([
      {
        kind: "postpone",
        eventId: downstreamId,
        newStart,
        notifyPatient: true,
      },
    ]);
  }

  // Compress candidate: sobre la cita causante, recortar slippage del plannedDuration
  const origin = findRuntime(ctx.validation.runtimes, trigger.originEventId);
  if (origin !== null) {
    const newDuration = Math.max(
      origin.plannedDuration - trigger.estimatedSlippage,
      5 * 60 * 1000, // mínimo 5 min, sanidad básica
    );
    if (newDuration < origin.plannedDuration) {
      candidates.push([
        {
          kind: "compress",
          eventId: trigger.originEventId,
          newDuration,
        },
      ]);
    }
  }

  // Ranking: postpone con menor newStart - r.start primero (menos disrupción).
  // Compress siempre al final con score 0.
  const ranked = takeTopN(candidates, maxCandidates, (c) => {
    const prim = c[0];
    if (prim.kind === "postpone") {
      const r = findRuntime(ctx.validation.runtimes, prim.eventId);
      if (r === null) return 0;
      const slippage = prim.newStart - r.start;
      return -slippage; // menor slippage = mayor score
    }
    if (prim.kind === "compress") return 0;
    return 0;
  });

  return keepValid(ranked, state, ctx);
}

/**
 * professional_unavailable: reasignar las citas del profesional ausente
 * dentro del rango a otros profesionales compatibles.
 *
 * Heurística: para cada appointment afectado, generar reassign_professional
 * a cada profesional compatible. Ranking por número de capacidades coincidentes
 * (más coincidencias = mejor match).
 */
function generateForProfessionalUnavailable(
  state: DayState,
  trigger: ProfessionalUnavailableTrigger,
  ctx: GenerationContext,
  maxCandidates: number,
): ReadonlyArray<CompositeAction> {
  // Encontrar appointments del profesional dentro del rango
  const affected: AppointmentRuntime[] = [];
  for (const eventId of Object.keys(ctx.validation.runtimes)) {
    const r = ctx.validation.runtimes[eventId];
    if (r.professionalId !== trigger.professionalId) continue;
    const aptEnd = r.start + r.plannedDuration;
    // Solape con el rango unavailable
    if (r.start < trigger.rangeEnd && aptEnd > trigger.rangeStart) {
      affected.push(r);
    }
  }
  if (affected.length === 0) return [];

  const candidates: CompositeAction[] = [];
  for (const apt of affected) {
    const compatibles = listProfessionalsCompatibleForRuntime(apt, ctx).filter(
      (id) => id !== trigger.professionalId,
    );
    for (const newProfId of compatibles) {
      candidates.push([
        {
          kind: "reassign_professional",
          eventId: apt.eventId,
          newProfessionalId: newProfId,
        },
      ]);
    }
  }

  // Ranking: heurística simple — todas igual de buenas en v1.
  // Cuando llegue C5 (Sesión 16) este orden no importa porque scoring real ahí.
  const top = candidates.slice(0, maxCandidates);
  return keepValid(top, state, ctx);
}

/**
 * proactive_sweep: v1 mínima — no genera candidatas no-triviales por ahora.
 * Cuando aparezcan heurísticas concretas (adelantar citas si hay
 * profesional libre, sugerir empate de huecos, etc.) se añaden aquí.
 */
function generateForProactiveSweep(): ReadonlyArray<CompositeAction> {
  return [];
}

// =============================================================================
// API pública
// =============================================================================

/**
 * Genera candidatas de acción para un trigger dado. Devuelve siempre al menos
 * [no_op] como primera candidata (invariante I-13). El resto son válidas
 * según C2 y rankeadas heurísticamente.
 *
 * @param state DayState actual del tenant.
 * @param runtimes runtimes paralelos al state.
 * @param trigger evento que dispara la generación (5 tipos soportados).
 * @param ctx contexto con validation, waitlist y opcional distribuciones.
 * @param options límites de generación.
 *
 * Nota: el argumento `runtimes` debería coincidir con `ctx.validation.runtimes`.
 * Aceptarlo separado simplifica la firma para tests y callers que ya lo tienen.
 * En Sesión 17 (Coordinator) se usará exclusivamente ctx.validation.runtimes.
 */
export function generateCandidates(
  state: DayState,
  runtimes: AppointmentRuntimeMap,
  trigger: GenerationTrigger,
  ctx: GenerationContext,
  options?: GenerationOptions,
): ReadonlyArray<CompositeAction> {
  // budgetMs se acepta pero no se aplica como wall-clock en v1.
  // Documentado como deuda para Sesión post-piloto.
  void options?.budgetMs;
  void runtimes; // ctx.validation.runtimes es la fuente de verdad

  const maxCandidates = effectiveMaxCandidates(options);

  let realCandidates: ReadonlyArray<CompositeAction> = [];
  switch (trigger.kind) {
    case "gap_detected":
      realCandidates = generateForGap(state, trigger, ctx, maxCandidates);
      break;
    case "no_show":
      realCandidates = generateForNoShow(state, trigger, ctx, maxCandidates);
      break;
    case "overrun_propagation":
      realCandidates = generateForOverrun(state, trigger, ctx, maxCandidates);
      break;
    case "professional_unavailable":
      realCandidates = generateForProfessionalUnavailable(
        state,
        trigger,
        ctx,
        maxCandidates,
      );
      break;
    case "proactive_sweep":
      realCandidates = generateForProactiveSweep();
      break;
  }

  // I-13: no_op siempre presente como primera candidata.
  return [NO_OP, ...realCandidates];
}

/**
 * Re-export de constantes públicas para tests.
 */
export const GENERATOR_DEFAULT_MAX_CANDIDATES = DEFAULT_MAX_CANDIDATES_PER_TRIGGER;
export const GENERATOR_DEFAULT_BUDGET_MS = DEFAULT_BUDGET_MS;

// Silenciar warnings TS de imports no usados directamente en el flujo principal
// pero documentados / referenciados en tipos:
type _UnusedMarker = AppointmentState | PrimitiveAction | DurationMs;
export type { _UnusedMarker };