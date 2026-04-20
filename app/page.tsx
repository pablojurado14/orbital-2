"use client";

import { useCallback, useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import AgendaGrid from "@/components/AgendaGrid";
import OrbitalPanel from "@/components/OrbitalPanel";
import KPIGrid from "@/components/KPIGrid";

type AppointmentStatus =
  | "confirmed"
  | "delayed"
  | "cancelled"
  | "suggested";

type EventType = "alert" | "info" | "warning" | "success";

type Appointment = {
  start: string;
  gabinete: string;
  patient: string;
  type: string;
  durationSlots: number;
  status: AppointmentStatus;
  value: number;
};

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

type SuggestionDecision = "pending" | "accepted" | "rejected";

type Suggestion = {
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

export default function Home() {
  const [state, setState] = useState<OrbitalStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/orbital-state", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("No se pudo cargar el estado de ORBITAL");
      }

      const data = (await response.json()) as OrbitalStateResponse;
      setState(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error desconocido al cargar el dashboard";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F5F1EB" }}>
      <Sidebar />

      <main style={{ flex: 1, padding: 24 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, marginBottom: 10, color: "#0F172A" }}>
            Agenda del día
          </h1>
          <p style={{ color: "#666", marginBottom: 0 }}>
            Vista en tiempo real — conectada al motor de decisión de ORBITAL
          </p>
        </div>

        {loading ? (
          <div
            style={{
              background: "white",
              borderRadius: 18,
              border: "1px solid #E2E8F0",
              padding: 24,
              color: "#475569",
            }}
          >
            Cargando dashboard...
          </div>
        ) : error || !state ? (
          <div
            style={{
              background: "#FFF1F2",
              borderRadius: 18,
              border: "1px solid #FECDD3",
              padding: 24,
              color: "#9F1239",
            }}
          >
            {error ?? "No se pudo cargar el estado del dashboard."}
          </div>
        ) : (
          <>
            <KPIGrid
              recoveredRevenue={state.recoveredRevenue ?? 0}
              recoveredGaps={state.recoveredGaps ?? 0}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) 360px",
                gap: 24,
                alignItems: "start",
              }}
            >
              <section>
                <AgendaGrid
                  appointments={state.appointments ?? []}
                  gabinetes={state.gabinetes ?? []}
                />
              </section>

              <OrbitalPanel
                suggestion={state.suggestion}
                rankedCandidates={state.rankedCandidates ?? []}
                events={state.events ?? []}
                recommendationReason={state.recommendationReason ?? ""}
                recoveredRevenue={state.recoveredRevenue ?? 0}
                recoveredGaps={state.recoveredGaps ?? 0}
                decision={state.suggestion ? "pending" : "accepted"}
                onStateChange={(nextState) => setState(nextState)}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
