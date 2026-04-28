/**
 * ORBITAL — Dominio dental
 * -----------------------------------------------------------------------------
 * Capa específica del vertical dental. Conoce vocabulario "gabinete", "dentista",
 * "tratamiento" y resuelve los externalRefs opacos del core a nombres legibles
 * para la UI.
 *
 * Esto es lo único que cambia al saltar de dental a fisio (futuro
 * lib/domains/physiotherapy.ts) o ambulatorio (lib/domains/ambulatory.ts).
 * El core no se toca.
 *
 * Cierra estructuralmente CLEAN-CORE-2 (acoplamiento dominio): el vocabulario
 * dental ya no vive en el motor.
 *
 * Ver core-contract.md §11 (capas externas) y §7.2.
 *
 * Notas Sesión 10: este archivo se realineó con la API real del clean core
 * v1.0. La capa dental hace traducción explícita: la UI sigue viendo
 * `recoveredGapsCount` y `sourceEventId` (nombres heredados que no romperemos
 * hasta Sesión 18), aunque el core devuelve `recoveredGaps` y `originEventId`.
 */

import type {
  EngineResult,
  RankedCandidate,
  ScheduledEvent,
  WaitingCandidate,
} from "@/lib/core/types";

// =============================================================================
// TIPOS DE PRESENTACIÓN DENTAL
// =============================================================================

/**
 * Vista de un evento programado con vocabulario dental resuelto.
 * La UI consume esto, no ScheduledEvent crudo.
 */
export type DentalEventView = {
  id: string;
  start: string;            // "HH:MM" local — formateado con ui/format.ts
  gabinete: string;         // resuelto desde externalRefs
  patient: string;          // resuelto desde externalRefs
  treatment: string;        // resuelto desde externalRefs
  durationSlots: number;    // duración convertida de ms a slots de 30 min
  status: ScheduledEvent["status"];
  value: number;
};

export type DentalGapView = {
  gabinete: string;
  start: string;
  durationSlots: number;
  cancelledPatient: string;
  lostValue: number;
  sourceEventId: string;
};

export type DentalCandidateView = {
  candidateId: string;
  name: string;
  treatment: string;
  durationSlots: number;
  value: number;
  totalScore: number;
  explanation: string;      // string traducido — Fase 9d via ui/i18n
  breakdown: RankedCandidate["breakdown"];
};

export type DentalSuggestionView = {
  patient: string;
  treatment: string;
  gabinete: string;
  start: string;
  durationSlots: number;
  value: number;
  sourceEventId: string;
};

/**
 * Resultado completo en vocabulario dental, listo para ser consumido por la UI.
 */
export type DentalEngineView = {
  events: DentalEventView[];
  gaps: DentalGapView[];
  rankings: Map<string, DentalCandidateView[]>;
  suggestions: DentalSuggestionView[];
  recoveredValue: number;
  recoveredGapsCount: number;
};

// =============================================================================
// HYDRATE — RESOLUCIÓN DE REFS
// =============================================================================

/**
 * Convierte un EngineResult abstracto + lista original de eventos en una vista
 * dental con todos los nombres resueltos.
 *
 * Llamada típica desde el caller (route.ts):
 *
 *   const events = (await prisma.appointment.findMany(...)).map(toScheduledEvent);
 *   const candidates = (await prisma.patient.findMany(...))
 *     .map(toWaitingCandidate)
 *     .filter((c): c is WaitingCandidate => c !== null);
 *   const result = decideFillForGap(events, candidates);
 *   const view = hydrate(result, events, candidates);
 *
 * @param translate Función que mapea ExplanationCode[] a string ES.
 *                  Default: fallback inline. Inyectable desde ui/i18n.
 */
export function hydrate(
  result: EngineResult,
  originalEvents: ReadonlyArray<ScheduledEvent>,
  originalCandidates: ReadonlyArray<WaitingCandidate>,
  translate: (codes: ReadonlyArray<string>) => string = fallbackTranslate,
): DentalEngineView {
  const candById = new Map(originalCandidates.map((c) => [c.id, c]));
  const evById = new Map(originalEvents.map((e) => [e.id, e]));

  const events: DentalEventView[] = originalEvents.map(toEventView);

  // Reconstruir gaps desde las suggestions. Cada Suggestion del core lleva
  // su gap embebido. Si en el futuro hay gaps detectados sin candidatos
  // viables, esa información se pierde con la API actual — anotado como
  // deuda en core-contract.md v2.0 §12.
  const gaps: DentalGapView[] = result.suggestions.map((s) => {
    const sourceEvent = evById.get(s.gap.originEventId);
    const refs = sourceEvent?.externalRefs ?? {};
    return {
      gabinete: refs.gabineteName ?? `Recurso ${s.gap.resourceId}`,
      start: refs.startTimeStr ?? formatStartFromInstant(s.gap.start),
      durationSlots: msToSlots(s.gap.duration),
      cancelledPatient: refs.patientName ?? "",
      // lostValue: el value del evento cancelado original (equivalente al
      // antiguo Gap.lostValue del contrato v1.0 markdown). El Gap del core
      // ya no lo expone directamente.
      lostValue: sourceEvent?.value ?? 0,
      sourceEventId: s.gap.originEventId,
    };
  });

  // Reconstruir rankings: cada Suggestion tiene recommended + alternatives,
  // que juntos forman el ranking del gap correspondiente.
  const rankings = new Map<string, DentalCandidateView[]>();
  for (const s of result.suggestions) {
    const fullRanking: RankedCandidate[] = [s.recommended, ...s.alternatives];
    rankings.set(
      s.gap.originEventId,
      fullRanking.map((r) => toCandidateView(r, candById, translate)),
    );
  }

  const suggestions: DentalSuggestionView[] = result.suggestions.map((s) => {
    const cand = candById.get(s.recommended.candidateId);
    const sourceEvent = evById.get(s.gap.originEventId);
    const candRefs = cand?.externalRefs ?? {};
    const evRefs = sourceEvent?.externalRefs ?? {};
    return {
      patient: candRefs.patientName ?? candRefs.name ?? s.recommended.candidateId,
      treatment: candRefs.treatmentName ?? "",
      gabinete: evRefs.gabineteName ?? `Recurso ${s.gap.resourceId}`,
      start: evRefs.startTimeStr ?? formatStartFromInstant(s.gap.start),
      durationSlots: msToSlots(s.gap.duration),
      value: cand?.value ?? 0,
      sourceEventId: s.gap.originEventId,
    };
  });

  return {
    events,
    gaps,
    rankings,
    suggestions,
    recoveredValue: result.recoveredValue,
    recoveredGapsCount: result.recoveredGaps,  // traducción explícita
  };
}

// =============================================================================
// HELPERS LOCALES
// =============================================================================

function toCandidateView(
  r: RankedCandidate,
  candById: Map<string, WaitingCandidate>,
  translate: (codes: ReadonlyArray<string>) => string,
): DentalCandidateView {
  const cand = candById.get(r.candidateId);
  const refs = cand?.externalRefs ?? {};
  return {
    candidateId: r.candidateId,
    name: refs.patientName ?? refs.name ?? r.candidateId,
    treatment: refs.treatmentName ?? "",
    durationSlots: cand ? msToSlots(cand.desiredDuration) : 0,
    value: cand?.value ?? 0,
    totalScore: r.totalScore,
    explanation: translate(r.explanationCodes),
    breakdown: r.breakdown,
  };
}

function toEventView(e: ScheduledEvent): DentalEventView {
  const refs = e.externalRefs ?? {};
  return {
    id: e.id,
    start: refs.startTimeStr ?? formatStartFromInstant(e.start),
    gabinete: refs.gabineteName ?? `Recurso ${e.resourceId}`,
    patient: refs.patientName ?? "",
    treatment: refs.treatmentName ?? "",
    durationSlots: msToSlots(e.duration),
    status: e.status,
    value: e.value ?? 0,
  };
}

function msToSlots(ms: number): number {
  return Math.max(1, Math.round(ms / (30 * 60 * 1000)));
}

function formatStartFromInstant(instant: number): string {
  // Fallback simple sin TZ. La capa ui/format.ts tiene la versión correcta
  // con timezone del tenant. Aquí solo es placeholder para casos raros
  // donde startTimeStr no está en externalRefs.
  const d = new Date(instant);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// =============================================================================
// TRANSLATE FALLBACK (será reemplazado por ui/i18n al inyectar translate)
// =============================================================================

const FALLBACK_ES: Record<string, string> = {
  FIT_EXACT: "encaje perfecto en duración",
  FIT_NEAR: "encaje razonable en duración",
  FIT_LOOSE: "encaje amplio con margen",
  RESOURCE_MATCH: "compatibilidad con gabinete",
  RESOURCE_MISMATCH: "gabinete no preferido",
  RESOURCE_NEUTRAL: "sin preferencia de gabinete",
  AVAILABILITY_HIGH: "disponibilidad inmediata",
  AVAILABILITY_LOW: "disponibilidad limitada",
  VALUE_HIGH: "valor alto",
  VALUE_MEDIUM: "valor medio",
  VALUE_LOW: "valor bajo",
  PRIORITY_HIGH: "prioridad alta",
  EASE_HIGH: "facilidad alta",
  EASE_LOW: "facilidad baja",
};

function fallbackTranslate(codes: ReadonlyArray<string>): string {
  return codes
    .map((c) => FALLBACK_ES[c] ?? c)
    .filter(Boolean)
    .join(", ");
}