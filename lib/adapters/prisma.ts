import type { ScheduledEvent, WaitingCandidate, EventStatus } from "@/lib/core/types";
import type { InstantUTC } from "@/lib/core/primitives";
import { SLOT_30_MIN_MS } from "@/lib/core/primitives";

interface AppointmentWithRelations {
  id: number;
  date: Date;
  startTime: string;
  durationSlots: number;
  status: string;
  value: number | null;
  patientId: number;
  dentistId: number;
  gabineteId: number;
  treatmentTypeId: number;
}

interface PatientWithRelations {
  id: number;
  name: string;
  inWaitingList: boolean;
  waitingTreatmentId: number | null;
  waitingDurationSlots: number | null;
  waitingValue: number | null;
  priority: number | null;
  availableNow: boolean | null;
  easeScore: number | null;
}

function combineDateAndTime(date: Date, startTime: string): InstantUTC {
  const [hh, mm] = startTime.split(":").map(Number);
  const d = new Date(date);
  d.setUTCHours(hh, mm, 0, 0);
  return d.getTime();
}

function mapStatus(s: string): EventStatus {
  if (s === "confirmed" || s === "delayed" || s === "cancelled" || s === "suggested") return s;
  return "confirmed";
}

function score1to5To01(n: number | null | undefined): number {
  if (n === null || n === undefined) return 0.5;
  return Math.max(0, Math.min(1, (n - 1) / 4));
}

export function toScheduledEvent(a: AppointmentWithRelations): ScheduledEvent {
  return {
    id: String(a.id),
    resourceId: String(a.gabineteId),
    start: combineDateAndTime(a.date, a.startTime),
    duration: a.durationSlots * SLOT_30_MIN_MS,
    status: mapStatus(a.status),
    value: a.value ?? undefined,
    externalRefs: {
      patientId: String(a.patientId),
      dentistId: String(a.dentistId),
      treatmentTypeId: String(a.treatmentTypeId),
    },
  };
}

export function toWaitingCandidate(p: PatientWithRelations): WaitingCandidate | null {
  if (!p.inWaitingList || !p.waitingDurationSlots || p.waitingValue === null) return null;
  return {
    id: String(p.id),
    desiredDuration: p.waitingDurationSlots * SLOT_30_MIN_MS,
    value: p.waitingValue,
    priority: score1to5To01(p.priority),
    easeScore: score1to5To01(p.easeScore),
    availableNow: p.availableNow ?? false,
    externalRefs: {
      patientName: p.name,
      treatmentTypeId: p.waitingTreatmentId ? String(p.waitingTreatmentId) : "",
    },
  };
}