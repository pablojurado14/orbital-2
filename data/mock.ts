export type AppointmentStatus =
  | "confirmed"
  | "delayed"
  | "cancelled"
  | "suggested";

export type EventType = "alert" | "info" | "warning" | "success";

export type Appointment = {
  start: string;
  gabinete: string;
  patient: string;
  type: string;
  durationSlots: number;
  status: AppointmentStatus;
  value: number;
};

export type WaitingPatient = {
  name: string;
  treatment: string;
  durationSlots: number;
  value: number;
  priority: number;
  availableNow: boolean;
  easeScore: number;
  preferredGabinete?: string;
};

export type OrbitalEvent = {
  time: string;
  title: string;
  body: string;
  type: EventType;
};

export type RankedCandidate = {
  name: string;
  treatment: string;
  durationSlots: number;
  value: number;
  totalScore: number;
  explanation: string;
  breakdown: {
    valueScore: number;
    fitScore: number;
    easeScore: number;
    availabilityScore: number;
    gabineteScore: number;
    priorityScore: number;
  };
};

export const HOURS = [
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
];
