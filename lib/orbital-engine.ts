/**
 * ORBITAL — Motor de decisión (Clean core)
 * -----------------------------------------------------------------------------
 * Reconstruido en v7.3 (20/04/2026) tras pérdida del entorno local.
 * Fuentes: contrato público (imports en route.ts, AgendaGrid, OrbitalPanel),
 * pesos documentados en §6 del master, tipado de data/mock.ts, y screenshots
 * de referencia del producto en funcionamiento.
 *
 * Responsabilidades:
 *   1. Detectar el primer gap operativo (cita cancelled) en la agenda.
 *   2. Filtrar candidatos de la lista de espera (filtro duro por duración).
 *   3. Puntuar candidatos según 6 factores ponderados.
 *   4. Construir el estado completo que consume el dashboard.
 *   5. Helpers de UI para estilos de eventos y citas.
 *
 * NO toca persistencia. No depende de Prisma. Es una función pura.
 * La capa de traducción schema ↔ motor vive en app/api/orbital-state/route.ts.
 *
 * Sesión 18.6 — cambios mínimos en tipos compartidos:
 *   - Suggestion extendida con gapEventId? y waitingCandidateId? opcionales,
 *     usados por el clean core (motor v2.0) para propagar IDs al frontend
 *     y permitir la iteración de candidatas (decisión rectora 11). El v7.3
 *     legacy NO los rellena — son opcionales y permanecen undefined cuando
 *     buildOrbitalState construye la suggestion.
 *   - Decisión rectora 12 (S18.6): la regla §7.3 ("no tocar este archivo
 *     salvo borrarlo en S19") queda relajada porque el v7.3 ya NO sirve
 *     respuestas (flag flippeado en S18.5). Modificar tipos compartidos
 *     ya no afecta a producción. Lógica del archivo NO se toca, solo tipos.
 */

import type {
  Appointment,
  AppointmentStatus,
  EventType,
  OrbitalEvent,
  RankedCandidate,
  WaitingPatient,
} from "@/data/mock";

// =============================================================================
// TIPOS PÚBLICOS
// =============================================================================

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
  // por compatibilidad con buildOrbitalState (v7.3 legacy) que los deja
  // undefined. El adapter del clean core (v2.0) sí los rellena.
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

// =============================================================================
// PESOS DEL SCORING (§6 del master — no tocar sin revisar producto)
// =============================================================================

const WEIGHTS = {
  value: 0.3, // Valor económico (normalizado min/max)
  fit: 0.25, // Encaje de duración con el hueco
  ease: 0.2, // Facilidad de ejecución (easeScore / 5)
  availability: 0.1, // Disponibilidad inmediata
  gabinete: 0.05, // Preferencia de gabinete
  priority: 0.1, // Prioridad clínica (priority / 5)
} as const;

// =============================================================================
// DETECCIÓN DE GAP
// =============================================================================

type Gap = {
  start: string;
  gabinete: string;
  durationSlots: number;
  cancelledPatient: string;
  cancelledValue: number;
};

function detectGap(appointments: Appointment[]): Gap | null {
  // Primer cancellation del día = gap operativo.
  // En futuras versiones: también detectar huecos naturales entre citas.
  const cancelled = appointments.find((a) => a.status === "cancelled");
  if (!cancelled) return null;

  return {
    start: cancelled.start,
    gabinete: cancelled.gabinete,
    durationSlots: cancelled.durationSlots,
    cancelledPatient: cancelled.patient,
    cancelledValue: cancelled.value,
  };
}

// =============================================================================
// SCORING
// =============================================================================

function fitScoreForDurationDiff(gapSlots: number, candidateSlots: number): number {
  const diff = gapSlots - candidateSlots;
  if (diff === 0) return 1.0; // Encaje exacto
  if (diff === 1) return 0.7; // Un slot de margen
  return 0.4; // Margen mayor (el candidato encaja pero "sobra hueco")
}

function scoreCandidate(
  candidate: WaitingPatient,
  gap: Gap,
  valueRange: { min: number; max: number }
): RankedCandidate {
  // 1. Valor (normalizado min/max sobre el conjunto de candidatos válidos)
  const valueSpan = valueRange.max - valueRange.min;
  const valueScore =
    valueSpan === 0 ? 1.0 : (candidate.value - valueRange.min) / valueSpan;

  // 2. Encaje de duración
  const fitScore = fitScoreForDurationDiff(gap.durationSlots, candidate.durationSlots);

  // 3. Facilidad de ejecución (clamp 0..1)
  const easeScore = Math.max(0, Math.min(1, candidate.easeScore / 5));

  // 4. Disponibilidad
  const availabilityScore = candidate.availableNow ? 1.0 : 0.2;

  // 5. Gabinete preferido
  //    - Sin preferencia → neutral (1.0)
  //    - Preferencia cumplida → 1.0
  //    - Preferencia no cumplida → 0.5
  const gabineteScore = !candidate.preferredGabinete
    ? 1.0
    : candidate.preferredGabinete === gap.gabinete
    ? 1.0
    : 0.5;

  // 6. Prioridad clínica (clamp 0..1)
  const priorityScore = Math.max(0, Math.min(1, candidate.priority / 5));

  const totalScore =
    WEIGHTS.value * valueScore +
    WEIGHTS.fit * fitScore +
    WEIGHTS.ease * easeScore +
    WEIGHTS.availability * availabilityScore +
    WEIGHTS.gabinete * gabineteScore +
    WEIGHTS.priority * priorityScore;

  return {
    name: candidate.name,
    treatment: candidate.treatment,
    durationSlots: candidate.durationSlots,
    value: candidate.value,
    totalScore: Number(totalScore.toFixed(4)),
    explanation: buildExplanation(fitScore, gabineteScore, availabilityScore),
    breakdown: {
      valueScore: Number(valueScore.toFixed(3)),
      fitScore: Number(fitScore.toFixed(3)),
      easeScore: Number(easeScore.toFixed(3)),
      availabilityScore: Number(availabilityScore.toFixed(3)),
      gabineteScore: Number(gabineteScore.toFixed(3)),
      priorityScore: Number(priorityScore.toFixed(3)),
    },
  };
}

function buildExplanation(
  fitScore: number,
  gabineteScore: number,
  availabilityScore: number
): string {
  const parts: string[] = [];

  if (fitScore === 1.0) parts.push("encaje perfecto en duración");
  else if (fitScore === 0.7) parts.push("encaje razonable en duración");
  else parts.push("encaje amplio con margen");

  if (gabineteScore === 1.0) parts.push("compatibilidad con gabinete");
  else parts.push("gabinete no preferido");

  if (availabilityScore < 1.0) parts.push("disponibilidad limitada");

  return parts.join(", ");
}

// =============================================================================
// TIMELINE DE EVENTOS
// =============================================================================

function subtractMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m - minutes;
  const newH = Math.floor(total / 60);
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

function buildEvents(gap: Gap | null, suggestion: Suggestion | null): OrbitalEvent[] {
  if (!gap) return [];

  const events: OrbitalEvent[] = [];

  events.push({
    time: subtractMinutes(gap.start, 5),
    title: "Cancelación detectada",
    body: `${gap.gabinete} · ${gap.cancelledPatient} ha cancelado su cita de ${
      gap.durationSlots * 30
    } min. Orbital detecta el hueco operativo disponible.`,
    type: "alert",
  });

  if (suggestion) {
    events.push({
      time: subtractMinutes(gap.start, 2),
      title: "Sugerencia de relleno",
      body: `${suggestion.patient} propuesto para cubrir el hueco con ${suggestion.type}. Valor recuperable: €${suggestion.value}.`,
      type: "info",
    });
  }

  return events;
}

// =============================================================================
// FUNCIÓN PRINCIPAL
// =============================================================================

export function buildOrbitalState(
  appointments: Appointment[],
  waitingList: WaitingPatient[],
  decision: SuggestionDecision = "pending"
): OrbitalState {
  const gap = detectGap(appointments);

  // Caso 1: no hay hueco operativo que cubrir.
  if (!gap) {
    return {
      appointments,
      suggestion: null,
      rankedCandidates: [],
      events: [],
      recommendationReason: "",
      recoveredRevenue: 0,
      recoveredGaps: 0,
      decision,
    };
  }

  // Filtro duro: descartamos candidatos que no caben en el hueco.
  const viableCandidates = waitingList.filter(
    (c) => c.durationSlots <= gap.durationSlots
  );

  // Si no hay candidatos viables tras el filtro.
  if (viableCandidates.length === 0) {
    return {
      appointments,
      suggestion: null,
      rankedCandidates: [],
      events: buildEvents(gap, null),
      recommendationReason: "No hay candidatos en lista de espera que encajen en el hueco.",
      recoveredRevenue: 0,
      recoveredGaps: 0,
      decision,
    };
  }

  // Rango de valores para normalizar (min/max sobre viables).
  const values = viableCandidates.map((c) => c.value);
  const valueRange = {
    min: Math.min(...values),
    max: Math.max(...values),
  };

  // Puntuar y ordenar descendente.
  const rankedCandidates = viableCandidates
    .map((c) => scoreCandidate(c, gap, valueRange))
    .sort((a, b) => b.totalScore - a.totalScore);

  const topCandidate = rankedCandidates[0];

  // Caso 2: decisión rechazada → no hay suggestion activa.
  if (decision === "rejected") {
    return {
      appointments,
      suggestion: null,
      rankedCandidates,
      events: buildEvents(gap, null),
      recommendationReason: "Sugerencia rechazada por el operador.",
      recoveredRevenue: 0,
      recoveredGaps: 0,
      decision,
    };
  }

  // Construir la suggestion (visible en agenda como status "suggested").
  // gapEventId/waitingCandidateId quedan undefined — son del clean core S18.6.
  const suggestion: Suggestion = {
    start: gap.start,
    gabinete: gap.gabinete,
    patient: topCandidate.name,
    type: topCandidate.treatment,
    durationSlots: topCandidate.durationSlots,
    status: "suggested",
    value: topCandidate.value,
  };

  // Inyectar la suggestion en la agenda visual.
  // La cita cancelled sigue en la lista, pero añadimos la sugerencia encima
  // del mismo slot/gabinete para que AgendaGrid la pinte con estilo "suggested".
  const appointmentsWithSuggestion: Appointment[] = [
    ...appointments.filter(
      (a) => !(a.status === "cancelled" && a.start === gap.start && a.gabinete === gap.gabinete)
    ),
    {
      start: suggestion.start,
      gabinete: suggestion.gabinete,
      patient: suggestion.patient,
      type: suggestion.type,
      durationSlots: suggestion.durationSlots,
      status: "suggested",
      value: suggestion.value,
    },
  ];

  const recommendationReason = `${topCandidate.name}: ${topCandidate.explanation}.`;

  // Caso 3: decisión aceptada → contabilizar impacto.
  if (decision === "accepted") {
    return {
      appointments: appointmentsWithSuggestion,
      suggestion,
      rankedCandidates,
      events: buildEvents(gap, suggestion),
      recommendationReason,
      recoveredRevenue: topCandidate.value,
      recoveredGaps: 1,
      decision,
    };
  }

  // Caso 4 (default): decision === "pending".
  // Suggestion visible en agenda y panel, pero impacto aún no contabilizado.
  return {
    appointments: appointmentsWithSuggestion,
    suggestion,
    rankedCandidates,
    events: buildEvents(gap, suggestion),
    recommendationReason,
    recoveredRevenue: 0,
    recoveredGaps: 0,
    decision,
  };
}

// =============================================================================
// HELPERS DE UI (usados por AgendaGrid y OrbitalPanel)
// =============================================================================

export function getAppointmentStyle(status: AppointmentStatus): {
  background: string;
  border: string;
} {
  switch (status) {
    case "confirmed":
      return { background: "#14B8A6", border: "#0F766E" };
    case "delayed":
      return { background: "#F59E0B", border: "#B45309" };
    case "cancelled":
      return { background: "#FEE2E2", border: "#FCA5A5" };
    case "suggested":
      // Fondo transparente + borde rojo punteado: el AgendaGrid lo renderiza
      // con borde sólido, así que usamos fondo muy tenue para diferenciarlo.
      return { background: "rgba(255, 240, 240, 0.6)", border: "#FCA5A5" };
    default:
      return { background: "#E2E8F0", border: "#CBD5E1" };
  }
}

export function getStatusLabel(status: AppointmentStatus): string {
  switch (status) {
    case "confirmed":
      return "Confirmada";
    case "delayed":
      return "Con retraso";
    case "cancelled":
      return "Cancelada";
    case "suggested":
      return "Sugerida";
    default:
      return status;
  }
}

export function getEventStyle(type: EventType): {
  background: string;
  borderLeft: string;
} {
  switch (type) {
    case "alert":
      return { background: "#FEF2F2", borderLeft: "3px solid #EF4444" };
    case "warning":
      return { background: "#FFFBEB", borderLeft: "3px solid #F59E0B" };
    case "success":
      return { background: "#ECFDF5", borderLeft: "3px solid #10B981" };
    case "info":
    default:
      return { background: "#EFF6FF", borderLeft: "3px solid #3B82F6" };
  }
}