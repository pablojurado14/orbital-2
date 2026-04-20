import type { Appointment } from "@/data/mock";

/**
 * Cuenta el total de citas del día.
 * Asume que el array de appointments ya viene filtrado por la fecha actual.
 */
export function countTodayAppointments(appointments: Appointment[]): number {
  return appointments.length;
}

/**
 * Calcula el porcentaje de ocupación.
 * Solo suma los slots de citas 'confirmed' o 'delayed'.
 * Ignora 'cancelled' y 'suggested'.
 */
export function calculateOccupancy(appointments: Appointment[], totalSlotsAvailable: number): number {
  if (totalSlotsAvailable === 0) return 0;

  const occupiedSlots = appointments
    .filter((a) => a.status === "confirmed" || a.status === "delayed")
    .reduce((sum, a) => sum + a.durationSlots, 0);

  const percentage = (occupiedSlots / totalSlotsAvailable) * 100;
  
  // Redondeamos para no tener decimales en la UI (ej: 87.5 -> 88)
  return Math.round(percentage);
}