/**
 * ORBITAL — Tipos del state operativo legacy.
 * -----------------------------------------------------------------------------
 * Extraídos de lib/orbital-engine.ts en Sesión 19.A (04/05/2026) como paso
 * previo a borrar el motor v7.3 legacy. La lógica del v7.3 (buildOrbitalState,
 * scoring, detección de gap, helpers de UI) se elimina con el archivo. Los
 * tipos sobreviven aquí porque siguen formando parte del contrato visible de
 * la API legacy /api/orbital-state, consumida por la UI (OrbitalPanel,
 * AgendaGrid, AppointmentDetailModal) y producida por el adapter del clean
 * core (lib/core/adapter.ts).
 *
 * Decisión rectora 12 (S18.6): tras el flippeo del flag en S18.5 el v7.3 ya
 * no sirve respuestas. Los tipos del contrato legacy son ahora propiedad
 * compartida adapter ↔ UI, no de la lógica del motor antiguo. Vivir aquí
 * refleja eso.
 *
 * Eventual evolución (post bloque MVP vendible, S20+): cuando la UI consuma
 * directamente Explanation/CycleDecision del clean core en lugar del shape
 * legacy traducido por cycleDecisionToOrbitalState, este archivo desaparece.
 */

import type {
  Appointment,
  AppointmentStatus,
  OrbitalEvent,
  RankedCandidate,
} from "@/data/mock";

export type SuggestionDecision = "pending" | "accepted" | "rejected";

export type Suggestion = {
  start: string;
  gabinete: string;
  patient: string;
  type: string;
  durationSlots: number;
  status: AppointmentStatus;
  value: number;
  // S18.6: IDs opacos del backend para iteración de candidatas. Opcionales
  // por compatibilidad histórica. El adapter del clean core los rellena
  // cuando la sugerencia proviene de un fill_from_waitlist; otros productores
  // pueden dejarlos undefined.
  gapEventId?: string;
  waitingCandidateId?: string;
};

export type OrbitalState = {
  appointments: Appointment[];
  suggestion: Suggestion | null;
  rankedCandidates: RankedCandidate[];
  events: OrbitalEvent[];
  recommendationReason: string;
  recoveredRevenue: number;
  recoveredGaps: number;
  decision: SuggestionDecision;
};