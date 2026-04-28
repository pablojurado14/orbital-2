/**
 * ORBITAL — Adapter Prisma ↔ Core
 * -----------------------------------------------------------------------------
 * Traduce entre los modelos Prisma (con vocabulario dental: gabinete, dentist,
 * treatmentType) y los tipos abstractos del core (resourceId opaco, externalRefs).
 *
 * Regla estricta: este archivo importa del core, NUNCA al revés.
 *
 * Cierra estructuralmente CLEAN-CORE-6 (acoplamiento tipos externos): el core
 * ya no importa de @/data/mock; los tipos de dominio se construyen aquí.
 *
 * Ver core-contract.md §7.1.
 */

import type {
  Appointment,
  Gabinete,
  Patient,
  TreatmentType,
} from "@prisma/client";
import type {
  ScheduledEvent,
  WaitingCandidate,
  EventStatus,
} from "@/lib/core/types";

// =============================================================================
// EVENT ADAPTER
// =============================================================================

export type AppointmentWithRelations = Appointment & {
  gabinete: Pick<Gabinete, "id" | "name">;
  patient: Pick<Patient, "id" | "name">;
  treatmentType: Pick<TreatmentType, "id" | "name"> | null;
};

export function toScheduledEvent(a: AppointmentWithRelations): ScheduledEvent {
  return {
    id: String(a.id),
    resourceId: String(a.gabineteId),
    start: combineDateAndTime(a.date, a.startTime),
    duration: a.duration * 60 * 1000,
    status: a.status as EventStatus,
    value: a.value ?? 0,
    externalRefs: Object.freeze({
      patientId: String(a.patientId),
      patientName: a.patient.name,
      treatmentTypeId: String(a.treatmentTypeId),
      treatmentName: a.treatmentType?.name ?? "",
      dentistId: String(a.dentistId),
      gabineteName: a.gabinete.name,
      startTimeStr: a.startTime,
    }),
  };
}

// =============================================================================
// CANDIDATE ADAPTER
// =============================================================================

export type PatientWithRelations = Patient & {
  waitingTreatment: Pick<TreatmentType, "id" | "name" | "duration" | "price"> | null;
  preferredGabinete: Pick<Gabinete, "id" | "name"> | null;
};

export function toWaitingCandidate(p: PatientWithRelations): WaitingCandidate {
  const fallbackDurationSlots = p.waitingTreatment?.duration
    ? Math.max(1, Math.round(p.waitingTreatment.duration / 30))
    : 1;
  const durationSlots = p.waitingDurationSlots ?? fallbackDurationSlots;

  return {
    id: String(p.id),
    requiredDuration: durationSlots * 30 * 60 * 1000,
    value: p.waitingValue ?? p.waitingTreatment?.price ?? 0,
    preferredResourceId: p.preferredGabineteId
      ? String(p.preferredGabineteId)
      : null,
    availableNow: p.availableNow,
    easeScore: clampScale1to5(p.easeScore),
    priority: clampScale1to5(p.priority),
    externalRefs: Object.freeze({
      name: p.name,
      treatmentTypeId: p.waitingTreatmentId ? String(p.waitingTreatmentId) : "",
      treatmentName: p.waitingTreatment?.name ?? "",
      preferredGabineteName: p.preferredGabinete?.name ?? "",
      requiredDurationSlots: String(durationSlots),
    }),
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function combineDateAndTime(date: Date, startTime: string): number {
  const [hours, minutes] = startTime.split(":").map(Number);
  return date.getTime() + (hours * 60 + minutes) * 60 * 1000;
}

function clampScale1to5(n: number): number {
  const ratio = (n - 1) / 4;
  if (ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}