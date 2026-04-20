"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { KPIGrid } from "@/components/KPIGrid";
import AgendaGrid from "@/components/AgendaGrid";
import OrbitalPanel from "@/components/OrbitalPanel";

type SuggestionDecision = "pending" | "accepted" | "rejected";

type AppointmentStatus =
  | "confirmed"
  | "delayed"
  | "cancelled"
  | "suggested";

type Appointment = {
  id?: number;
  start: string;
  gabinete: string;
  patient: string;
  type: string;
  durationSlots: number;
  status: AppointmentStatus;
  value: number;
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

type EventType = "alert" | "info" | "warning" | "success";

type OrbitalEvent = {
  time: string;
  title: string;
  body: string;
  type: EventType;
};

type Metrics = {
  appointmentsCount: number;
  occupancy: number;
  recoveredGaps: number;
  recoveredRevenue: number;
};

type OrbitalStateResponse = {
  metrics: Metrics;
  appointments: Appointment[];
  suggestion: Suggestion | null;
  rankedCandidates: RankedCandidate[];
  events: OrbitalEvent[];
  recommendationReason: string;
  recoveredRevenue: number;
  recoveredGaps: number;
  decision: SuggestionDecision;
  gabinetes: string[];
};

export default function Dashboard() {
  const [state, setState] = useState<OrbitalStateResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchState() {
    try {
      const response = await fetch("/api/orbital-state");

      if (!response.ok) {
        throw new Error("Error fetching orbital state");
      }

      const data = (await response.json()) as OrbitalStateResponse;
      setState(data);
    } catch (error) {
      console.error("Error fetching state:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchState();
  }, []);

  if (loading || !state) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600"></div>
          <p className="font-medium text-slate-500">Cargando Orbital 2.0...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto p-8">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Panel de Control</h1>
            <p className="text-slate-500">Optimización operativa en tiempo real</p>
          </div>
        </header>

        <KPIGrid metrics={state.metrics} />

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AgendaGrid
              appointments={state.appointments}
              gabinetes={state.gabinetes}
            />
          </div>

          <div>
            <OrbitalPanel
              suggestion={state.suggestion}
              rankedCandidates={state.rankedCandidates}
              events={state.events}
              recommendationReason={state.recommendationReason}
              recoveredRevenue={state.recoveredRevenue}
              recoveredGaps={state.recoveredGaps}
              decision={state.decision}
              onStateChange={setState}
            />
          </div>
        </div>
      </main>
    </div>
  );
}