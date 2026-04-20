"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HOURS } from "@/data/mock";
import { getAppointmentStyle, getStatusLabel } from "@/lib/orbital-engine";

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

type Props = {
  appointments: Appointment[];
  gabinetes: string[];
};

const SLOT_HEIGHT = 64;
const TIME_COLUMN_WIDTH = 92;

export default function AgendaGrid({ appointments, gabinetes }: Props) {
  const router = useRouter();
  const [cancellingAppointmentId, setCancellingAppointmentId] = useState<number | null>(null);

  const totalHeight = HOURS.length * SLOT_HEIGHT;

  async function cancelAppointment(appointmentId: number) {
    try {
      setCancellingAppointmentId(appointmentId);

      const response = await fetch("/api/appointments/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ appointmentId }),
      });

      if (!response.ok) {
        throw new Error("No se pudo cancelar la cita");
      }

      router.refresh();
    } catch (error) {
      console.error(error);
      alert("No se pudo cancelar la cita. Revisa la consola.");
    } finally {
      setCancellingAppointmentId(null);
    }
  }

  return (
    <div
      style={{
        background: "white",
        borderRadius: 18,
        border: "1px solid #E2E8F0",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${TIME_COLUMN_WIDTH}px repeat(${gabinetes.length}, 1fr)`,
          borderBottom: "1px solid #E2E8F0",
          background: "#F8FAFC",
        }}
      >
        <div style={{ padding: "15px", borderRight: "1px solid #E2E8F0" }} />
        {gabinetes.map((gabinete) => (
          <div
            key={gabinete}
            style={{
              padding: "15px",
              textAlign: "center",
              fontWeight: 700,
              fontSize: 13,
              color: "#475569",
              borderRight: "1px solid #E2E8F0",
            }}
          >
            {gabinete}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `${TIME_COLUMN_WIDTH}px 1fr` }}>
        <div
          style={{
            position: "relative",
            height: totalHeight,
            borderRight: "1px solid #E2E8F0",
            background: "#F8FAFC",
          }}
        >
          {HOURS.map((hour, index) => (
            <div
              key={hour}
              style={{
                position: "absolute",
                top: index * SLOT_HEIGHT,
                left: 0,
                right: 0,
                height: SLOT_HEIGHT,
                borderBottom: "1px solid #F1F5F9",
                padding: "8px 10px",
                boxSizing: "border-box",
                fontSize: 12,
                color: "#94A3B8",
                fontWeight: 700,
                textAlign: "right",
              }}
            >
              {hour}
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${gabinetes.length}, 1fr)`,
          }}
        >
          {gabinetes.map((gabinete) => {
            const appointmentsForGabinete = appointments
              .filter((appointment) => appointment.gabinete === gabinete)
              .filter((appointment) => HOURS.includes(appointment.start));

            return (
              <div
                key={gabinete}
                style={{
                  position: "relative",
                  height: totalHeight,
                  borderRight: "1px solid #F1F5F9",
                  background: "white",
                }}
              >
                {HOURS.map((hour, index) => (
                  <div
                    key={`${gabinete}-${hour}`}
                    style={{
                      position: "absolute",
                      top: index * SLOT_HEIGHT,
                      left: 0,
                      right: 0,
                      height: SLOT_HEIGHT,
                      borderBottom: "1px solid #F1F5F9",
                    }}
                  />
                ))}

                {appointmentsForGabinete.map((appointment, index) => {
                  const slotIndex = HOURS.indexOf(appointment.start);
                  if (slotIndex === -1) return null;

                  const top = slotIndex * SLOT_HEIGHT + 4;
                  const height = Math.max(1, appointment.durationSlots) * SLOT_HEIGHT - 8;
                  const style = getAppointmentStyle(appointment.status);
                  const canCancel =
                    appointment.id !== undefined &&
                    appointment.status !== "cancelled" &&
                    appointment.status !== "suggested";
                  const isCancelling = cancellingAppointmentId === appointment.id;

                  return (
                    <div
                      key={`${gabinete}-${appointment.start}-${appointment.patient}-${index}`}
                      style={{
                        position: "absolute",
                        top,
                        left: 8,
                        right: 8,
                        height,
                        background: style.background,
                        border: `1px solid ${style.border}`,
                        borderRadius: 10,
                        padding: 8,
                        boxSizing: "border-box",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.03)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "start",
                          justifyContent: "space-between",
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 800,
                            fontSize: 11,
                            color: "#1E293B",
                            lineHeight: 1.3,
                          }}
                        >
                          {appointment.patient}
                        </div>

                        <div
                          style={{
                            fontSize: 9,
                            fontWeight: 800,
                            color: "#475569",
                            background: "rgba(255,255,255,0.6)",
                            borderRadius: 999,
                            padding: "2px 6px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {getStatusLabel(appointment.status)}
                        </div>
                      </div>

                      <div style={{ fontSize: 10, color: "#334155", lineHeight: 1.4 }}>
                        {appointment.type}
                      </div>

                      <div style={{ fontSize: 10, color: "#64748B", marginTop: 6 }}>
                        {appointment.start} · {appointment.durationSlots * 30} min
                      </div>

                      <div style={{ fontSize: 10, color: "#64748B", marginTop: 2 }}>
                        €{appointment.value}
                      </div>

                      {canCancel ? (
                        <button
                          type="button"
                          onClick={() => void cancelAppointment(appointment.id!)}
                          disabled={isCancelling}
                          style={{
                            marginTop: 8,
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            color: "#DC2626",
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: isCancelling ? "not-allowed" : "pointer",
                            opacity: isCancelling ? 0.6 : 1,
                          }}
                        >
                          {isCancelling ? "Cancelando..." : "Cancelar"}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}