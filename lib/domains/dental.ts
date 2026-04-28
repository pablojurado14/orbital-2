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
 * Ver core-contract.md §7.2.
 */

import type {
  EngineResult,
  Gap,
  RankedCandidate,
  ScheduledEvent,
  Suggestion,
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
 * Llamada típica desde el caller (route.ts en Sesión 10):
 *
 *   const events = (await prisma.appointment.findMany(...)).map(toScheduledEvent);
 *   const candidates = (await prisma.patient.findMany(...)).map(toWaitingCandidate);
 *   const result = decideFillForGap(events, candidates);
 *   const view = hydrate(result, events, candidates);
 *
 * Translator de explanation se aplica en Fase 9d (ui/i18n) y se inyecta aquí.
 *
 * @param translate Función que mapea ExplanationCode[] a string ES.
 *                  En Fase 9c sin i18n usa fallback inline; Fase 9d sustituye
 *                  por la del módulo i18n.
 */
export function hydrate(
  result: EngineResult,
  originalEvents: ReadonlyArray<ScheduledEvent>,
  originalCandidates: ReadonlyArray<{ id: string; externalRefs: Readonly<Record<string, string>> }>,
  translate: (codes: ReadonlyArray<string>) => string = fallbackTranslate,
): DentalEngineView {
  const candById = new Map(originalCandidates.map((c) => [c.id, c]));
  const evById = new Map(originalEvents.map((e) => [e.id, e]));

  const events: DentalEventView[] = originalEvents.map(toEventView);

  const gaps: DentalGapView[] = result.gaps.map((g) => {
    const sourceEvent = evById.get(g.sourceEventId);
    return {
      gabinete: sourceEvent?.externalRefs.gabineteName ?? `Recurso ${g.resourceId}`,
      start: sourceEvent?.externalRefs.startTimeStr ?? formatStartFromInstant(g.start),
      durationSlots: msToSlots(g.duration),
      cancelledPatient: lookupPatientNameByEvent(sourceEvent, originalCandidates) ?? "",
      lostValue: g.lostValue,
      sourceEventId: g.sourceEventId,
    };
  });

  const rankings = new Map<string, DentalCandidateView[]>();
  for (const [eventId, ranked] of result.rankingsByGap.entries()) {
    rankings.set(
      eventId,
      ranked.map((r) => {
        const cand = candById.get(r.candidateId);
        return {
          candidateId: r.candidateId,
          name: cand?.externalRefs.name ?? r.candidateId,
          treatment: cand?.externalRefs.treatmentName ?? "",
          durationSlots: cand?.externalRefs.requiredDurationSlots
            ? Number(cand.externalRefs.requiredDurationSlots)
            : 0,
          value: 0,  // se rellena con el lookup en suggestions; ver nota en hydrate
          totalScore: r.totalScore,
          explanation: translate(r.explanationCodes),
          breakdown: r.breakdown,
        };
      }),
    );
  }

  const suggestions: DentalSuggestionView[] = result.suggestions.map((s) => {
    const cand = candById.get(s.candidateId);
    const sourceEvent = evById.get(s.gapSourceEventId);
    return {
      patient: cand?.externalRefs.name ?? s.candidateId,
      treatment: cand?.externalRefs.treatmentName ?? "",
      gabinete: sourceEvent?.externalRefs.gabineteName ?? `Recurso ${s.resourceId}`,
      start: sourceEvent?.externalRefs.startTimeStr ?? formatStartFromInstant(s.start),
      durationSlots: msToSlots(s.duration),
      value: s.value,
      sourceEventId: s.gapSourceEventId,
    };
  });

  return {
    events,
    gaps,
    rankings,
    suggestions,
    recoveredValue: result.recoveredValue,
    recoveredGapsCount: result.recoveredGapsCount,
  };
}

// =============================================================================
// HELPERS LOCALES
// =============================================================================

function toEventView(e: ScheduledEvent): DentalEventView {
  return {
    id: e.id,
    start: e.externalRefs.startTimeStr ?? formatStartFromInstant(e.start),
    gabinete: e.externalRefs.gabineteName ?? `Recurso ${e.resourceId}`,
    patient: e.externalRefs.patientName ?? "",
    treatment: e.externalRefs.treatmentName ?? "",
    durationSlots: msToSlots(e.duration),
    status: e.status,
    value: e.value,
  };
}

function msToSlots(ms: number): number {
  return Math.max(1, Math.round(ms / (30 * 60 * 1000)));
}

function formatStartFromInstant(instant: number): string {
  // Fallback simple sin TZ. La capa ui/format.ts (Fase 9d) hace esto bien
  // con timezone del tenant. Aquí solo es placeholder para casos raros
  // donde startTimeStr no está en externalRefs.
  const d = new Date(instant);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function lookupPatientNameByEvent(
  event: ScheduledEvent | undefined,
  _candidates: ReadonlyArray<{ id: string; externalRefs: Readonly<Record<string, string>> }>,
): string | null {
  // El nombre del paciente cancelado no está en candidates (los pacientes
  // de la lista de espera son distintos). Vive en externalRefs del propio
  // evento, que el adapter Prisma debe rellenar. Si el adapter no lo
  // rellenó (por motivos de privacidad o por simplificación), devolvemos null.
  if (!event) return null;
  return event.externalRefs.patientName ?? null;
}

// =============================================================================
// TRANSLATE FALLBACK (será reemplazado en Fase 9d con ui/i18n)
// =============================================================================

const FALLBACK_ES: Record<string, string> = {
  FIT_EXACT: "encaje perfecto en duración",
  FIT_NEAR: "encaje razonable en duración",
  FIT_LOOSE: "encaje amplio con margen",
  RESOURCE_MATCH: "compatibilidad con gabinete",
  RESOURCE_MISMATCH: "gabinete no preferido",
  RESOURCE_NEUTRAL: "sin preferencia de gabinete",
  AVAILABILITY_IMMEDIATE: "disponibilidad inmediata",
  AVAILABILITY_LIMITED: "disponibilidad limitada",
};

function fallbackTranslate(codes: ReadonlyArray<string>): string {
  return codes
    .map((c) => FALLBACK_ES[c] ?? c)
    .filter(Boolean)
    .join(", ");
}