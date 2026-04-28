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

// Granularidad VISUAL del AgendaGrid: celdillas de 15 min, de 08:00 a 20:45.
// Total: 52 celdillas (= 26 slots operativos de 30 min equivalentes).
//
// Granularidad OPERATIVA del motor y modelo: sigue en slots de 30 min hasta
// Sesión 9 (deuda GRANULARITY-15MIN documentada en §4 del master). Las citas
// solo pueden empezar en franjas en punto o media (xx:00, xx:30) — las
// celdillas xx:15 y xx:45 son visuales, no clickables para crear cita.
export const HOURS = [
  "08:00", "08:15", "08:30", "08:45",
  "09:00", "09:15", "09:30", "09:45",
  "10:00", "10:15", "10:30", "10:45",
  "11:00", "11:15", "11:30", "11:45",
  "12:00", "12:15", "12:30", "12:45",
  "13:00", "13:15", "13:30", "13:45",
  "14:00", "14:15", "14:30", "14:45",
  "15:00", "15:15", "15:30", "15:45",
  "16:00", "16:15", "16:30", "16:45",
  "17:00", "17:15", "17:30", "17:45",
  "18:00", "18:15", "18:30", "18:45",
  "19:00", "19:15", "19:30", "19:45",
  "20:00", "20:15", "20:30", "20:45",
];