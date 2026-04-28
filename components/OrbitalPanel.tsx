"use client";

import { useMemo, useState } from "react";
import { getEventStyle } from "@/lib/orbital-engine";

type EventType = "alert" | "info" | "warning" | "success";
type SuggestionDecision = "pending" | "accepted" | "rejected";

type RankedCandidate = {
  name: string;
  treatment: string;
  durationSlots: number;
  value: number;
  totalScore: number;
  explanation: string;
  breakdown?: {
    valueScore: number;
    fitScore: number;
    easeScore: number;
    availabilityScore: number;
    gabineteScore: number;
    priorityScore: number;
  };
};

type OrbitalEvent = {
  time: string;
  title: string;
  body: string;
  type: EventType;
};

type Suggestion = {
  start: string;
  gabinete: string;
  patient: string;
  type: string;
  durationSlots: number;
  status: "confirmed" | "delayed" | "cancelled" | "suggested";
  value: number;
};

type AppointmentStatus =
  | "confirmed"
  | "delayed"
  | "cancelled"
  | "suggested";

type Appointment = {
  start: string;
  gabinete: string;
  patient: string;
  type: string;
  durationSlots: number;
  status: AppointmentStatus;
  value: number;
};

type OrbitalStateResponse = {
  appointments: Appointment[];
  gabinetes: string[];
  suggestion: Suggestion | null;
  rankedCandidates: RankedCandidate[];
  events: OrbitalEvent[];
  recommendationReason: string;
  recoveredRevenue: number;
  recoveredGaps: number;
  decision?: SuggestionDecision;
};

type Props = {
  suggestion: Suggestion | null;
  rankedCandidates: RankedCandidate[];
  events: OrbitalEvent[];
  recommendationReason: string;
  decision: SuggestionDecision;
  onStateChange: (nextState: OrbitalStateResponse) => void;
};

export default function OrbitalPanel({
  suggestion,
  rankedCandidates,
  events,
  recommendationReason,
  decision,
  onStateChange,
}: Props) {
  const [submitting, setSubmitting] = useState(false);

  const hasSuggestion = Boolean(suggestion);
  const isPending = decision === "pending";
  const isAccepted = decision === "accepted";
  const isRejected = decision === "rejected";
  const canReopenSuggestion = !isPending;
  const topCandidates = useMemo(() => rankedCandidates.slice(0, 3), [rankedCandidates]);

  async function submitDecision(action: SuggestionDecision | "reset") {
    try {
      setSubmitting(true);

      const response = await fetch("/api/orbital-state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        throw new Error("No se pudo actualizar la decisión");
      }

      const updatedState = (await response.json()) as OrbitalStateResponse;
      onStateChange(updatedState);
    } catch (error) {
      console.error(error);
      alert("No se pudo actualizar la decisión. Revisa la consola.");
    } finally {
      setSubmitting(false);
    }
  }

  function renderDecisionBanner() {
    if (isAccepted) {
      return (
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            background: "#ECFDF5",
            border: "1px solid #A7F3D0",
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: "#047857", marginBottom: 6 }}>
            Caso resuelto
          </div>
          <div style={{ fontSize: 13, color: "#065F46", lineHeight: 1.6 }}>
            La sugerencia ha sido aceptada. El hueco operativo ya se considera cubierto.
          </div>
        </div>
      );
    }

    if (isRejected) {
      return (
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: "#B91C1C", marginBottom: 6 }}>
            Caso descartado
          </div>
          <div style={{ fontSize: 13, color: "#7F1D1D", lineHeight: 1.6 }}>
            La sugerencia ha sido rechazada. Puedes reabrir el caso si necesitas volver a evaluarlo.
          </div>
        </div>
      );
    }

    return null;
  }

  function renderReopenButton() {
    if (!canReopenSuggestion) {
      return null;
    }

    return (
      <button
        type="button"
        onClick={() => void submitDecision("reset")}
        disabled={submitting}
        style={{
          flex: 1,
          minWidth: 160,
          borderRadius: 12,
          padding: "12px 14px",
          background: "#FFFFFF",
          color: "#0F172A",
          fontWeight: 700,
          border: "1px solid #CBD5E1",
          cursor: submitting ? "not-allowed" : "pointer",
          opacity: submitting ? 0.7 : 1,
        }}
      >
        Volver a pendiente
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          background: "#0F2744",
          borderRadius: 18,
          padding: 20,
          color: "white",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 15 }}>
          <div
            style={{
              width: 10,
              height: 10,
              background: hasSuggestion ? "#F59E0B" : "#10B981",
              borderRadius: "50%",
            }}
          />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>
            ORBITAL ENGINE ACTIVE
          </span>
        </div>

        <p style={{ fontSize: 13, color: "#B6C2D1", lineHeight: 1.6, margin: 0 }}>
          {hasSuggestion
            ? "He detectado una oportunidad operativa con impacto económico recuperable."
            : "Monitorizando agenda en busca de huecos, cancelaciones o desajustes de operativa."}
        </p>
      </div>

      <div
        style={{
          background: "white",
          borderRadius: 18,
          border: "1px solid #E2E8F0",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 20, borderBottom: "1px solid #F1F5F9" }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: "#1E293B" }}>
            Acción recomendada
          </h3>
          <div style={{ marginTop: 6, fontSize: 11, color: "#94A3B8" }}>
            Estado actual:{" "}
            <strong style={{ color: "#475569", textTransform: "capitalize" }}>
              {decision}
            </strong>
          </div>
        </div>

        <div style={{ padding: 20 }}>
          {!hasSuggestion && isPending ? (
            <div
              style={{
                padding: 14,
                borderRadius: 12,
                background: "#F8FAFC",
                border: "1px solid #E2E8F0",
                color: "#475569",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              No hay sugerencia activa. El motor seguirá monitorizando la agenda.
            </div>
          ) : null}

          {!hasSuggestion && !isPending ? (
            <>
              {renderDecisionBanner()}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {renderReopenButton()}
              </div>
            </>
          ) : null}

          {hasSuggestion && suggestion ? (
            <>
              {renderDecisionBanner()}

              <div
                style={{
                  padding: 14,
                  borderRadius: 12,
                  background: "#EFF6FF",
                  border: "1px solid #BFDBFE",
                  marginBottom: 14,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: "#1E3A8A", marginBottom: 6 }}>
                  Recomendada
                </div>

                <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                  Llamar a {suggestion.patient} para {suggestion.type}
                </div>

                <div style={{ fontSize: 12, color: "#475569", marginTop: 6, lineHeight: 1.6 }}>
                  Hueco: {suggestion.start} · {suggestion.gabinete} ·{" "}
                  {suggestion.durationSlots * 30} min
                </div>

                <div style={{ fontSize: 12, color: "#475569", marginTop: 4, lineHeight: 1.6 }}>
                  Valor estimado: €{suggestion.value}
                </div>
              </div>

              <div
                style={{
                  padding: 14,
                  borderRadius: 12,
                  background: "#F8FAFC",
                  border: "1px solid #E2E8F0",
                  marginBottom: 14,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: "#334155", marginBottom: 6 }}>
                  Motivo
                </div>
                <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6 }}>
                  {recommendationReason || "Sugerencia generada por el motor."}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {isPending ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void submitDecision("accepted")}
                      disabled={submitting}
                      style={{
                        flex: 1,
                        minWidth: 160,
                        border: "none",
                        borderRadius: 12,
                        padding: "12px 14px",
                        background: "#10B981",
                        color: "white",
                        fontWeight: 700,
                        cursor: submitting ? "not-allowed" : "pointer",
                        opacity: submitting ? 0.7 : 1,
                      }}
                    >
                      Aceptar
                    </button>

                    <button
                      type="button"
                      onClick={() => void submitDecision("rejected")}
                      disabled={submitting}
                      style={{
                        flex: 1,
                        minWidth: 160,
                        border: "none",
                        borderRadius: 12,
                        padding: "12px 14px",
                        background: "#EF4444",
                        color: "white",
                        fontWeight: 700,
                        cursor: submitting ? "not-allowed" : "pointer",
                        opacity: submitting ? 0.7 : 1,
                      }}
                    >
                      Rechazar
                    </button>
                  </>
                ) : null}

                {renderReopenButton()}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div
        style={{
          background: "white",
          borderRadius: 18,
          border: "1px solid #E2E8F0",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 20, borderBottom: "1px solid #F1F5F9" }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: "#1E293B" }}>
            Ranking de candidatos
          </h3>
          <span style={{ fontSize: 11, color: "#94A3B8" }}>
            Top {topCandidates.length} por scoring del motor
          </span>
        </div>

        <div style={{ padding: 12 }}>
          {topCandidates.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#94A3B8", fontSize: 13 }}>
              No hay candidatos válidos para el hueco detectado.
            </div>
          ) : (
            topCandidates.map((candidate, index) => (
              <div
                key={`${candidate.name}-${index}`}
                style={{
                  padding: 14,
                  background: "#F8FAFC",
                  borderRadius: 12,
                  marginBottom: 10,
                  border: "1px solid #E2E8F0",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "start",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 8,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 13, color: "#0F172A" }}>
                      #{index + 1} · {candidate.name}
                    </div>
                    <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
                      {candidate.treatment} · {candidate.durationSlots * 30} min · €
                      {candidate.value}
                    </div>
                  </div>

                  <div
                    style={{
                      background: "#E2E8F0",
                      borderRadius: 999,
                      padding: "5px 9px",
                      fontSize: 11,
                      fontWeight: 800,
                      color: "#0F172A",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {candidate.totalScore.toFixed(2)}
                  </div>
                </div>

                <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.6 }}>
                  {candidate.explanation}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div
        style={{
          background: "white",
          borderRadius: 18,
          border: "1px solid #E2E8F0",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 20, borderBottom: "1px solid #F1F5F9" }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: "#1E293B" }}>
            Timeline de eventos
          </h3>
        </div>

        <div style={{ padding: 12 }}>
          {events.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#94A3B8", fontSize: 13 }}>
              Sin eventos recientes.
            </div>
          ) : (
            events.map((event, index) => {
              const style = getEventStyle(event.type);

              return (
                <div
                  key={`${event.time}-${event.title}-${index}`}
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    marginBottom: 10,
                    background: style.background,
                    borderLeft: style.borderLeft,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 13, color: "#0F172A" }}>
                      {event.title}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748B", whiteSpace: "nowrap" }}>
                      {event.time}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6 }}>
                    {event.body}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}