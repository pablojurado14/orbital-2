/**
 * ORBITAL — Estilos de UI
 * -----------------------------------------------------------------------------
 * Helpers visuales (colores, bordes) que antes vivían en lib/orbital-engine.ts.
 * Mover aquí cierra CLEAN-CORE-3 (acoplamiento UI) — el core puro no devuelve
 * decisiones visuales.
 *
 * Mantiene la firma exacta de v7.3 para compatibilidad inmediata cuando
 * Sesión 10 migre los callers.
 */

export type AppointmentStatus =
  | "confirmed"
  | "delayed"
  | "cancelled"
  | "suggested";

export type EventType = "alert" | "info" | "warning" | "success";

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
      return { background: "rgba(255, 240, 240, 0.6)", border: "#FCA5A5" };
    default:
      return { background: "#E2E8F0", border: "#CBD5E1" };
  }
}

export function getStatusLabel(status: AppointmentStatus): string {
  // Estos labels son fallback en caso de no usar t("status.{key}").
  // En componentes nuevos, preferir t() del módulo i18n.
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