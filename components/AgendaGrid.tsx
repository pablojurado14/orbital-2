"use client";

import { useEffect, useRef, useState } from "react";
import { HOURS } from "@/data/mock";
import { getAppointmentStyle, getStatusLabel } from "@/lib/orbital-engine";
import AppointmentDetailModal from "@/components/AppointmentDetailModal";

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
  editable?: boolean;
  onEmptySlotClick?: (gabineteName: string, hour: string) => void;
  gabinetesForMove?: { id: number; name: string }[];
};

const SLOT_HEIGHT = 36; // altura de cada celdilla visual de 15 min
const TIME_COLUMN_WIDTH = 92;
const SCROLL_VIEWPORT_HEIGHT = 600;
const NOW_SLOT_BG = "#F1F5F9";

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Devuelve el índice de la celdilla de 15 min que contiene la hora actual,
// o -1 si la hora actual cae fuera del rango pintado.
function findCurrentSlotIndex(): number {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < HOURS.length; i++) {
    const start = hhmmToMinutes(HOURS[i]);
    if (nowMin >= start && nowMin < start + 15) return i;
  }
  return -1;
}

export default function AgendaGrid({
  appointments,
  gabinetes,
  editable = false,
  onEmptySlotClick,
  gabinetesForMove,
}: Props) {
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [currentSlotIndex, setCurrentSlotIndex] = useState<number>(() => findCurrentSlotIndex());
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const totalHeight = HOURS.length * SLOT_HEIGHT;

  // Auto-scroll inicial: centrar la celdilla actual en el viewport.
  useEffect(() => {
    if (!scrollerRef.current) return;
    const targetSlot = currentSlotIndex >= 0 ? currentSlotIndex : 0;
    const targetPx = targetSlot * SLOT_HEIGHT;
    const centered = Math.max(0, targetPx - SCROLL_VIEWPORT_HEIGHT / 2 + SLOT_HEIGHT / 2);
    scrollerRef.current.scrollTop = centered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresca el slot "ahora" justo cuando termina la celdilla actual (cada 15 min).
  // Latencia <1s al cruzar el límite.
  useEffect(() => {
    let timerId: number | null = null;

    const scheduleNext = () => {
      const now = new Date();
      const minutesIntoSlot = now.getMinutes() % 15;
      const secondsIntoMinute = now.getSeconds();
      const msIntoSlot =
        minutesIntoSlot * 60_000 + secondsIntoMinute * 1000 + now.getMilliseconds();
      const msUntilNextSlot = 15 * 60_000 - msIntoSlot + 50;

      timerId = window.setTimeout(() => {
        setCurrentSlotIndex(findCurrentSlotIndex());
        scheduleNext();
      }, msUntilNextSlot);
    };

    scheduleNext();

    return () => {
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, []);

  return (
    <>
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
        {/* Cabecera de gabinetes */}
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

        {/* Viewport scrollable */}
        <div
          ref={scrollerRef}
          style={{
            position: "relative",
            maxHeight: SCROLL_VIEWPORT_HEIGHT,
            overflowY: "auto",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: `${TIME_COLUMN_WIDTH}px 1fr` }}>
            {/* Columna de horas */}
            <div
              style={{
                position: "relative",
                height: totalHeight,
                borderRight: "1px solid #E2E8F0",
                background: "#F8FAFC",
              }}
            >
              {HOURS.map((hour, index) => {
                const isNow = index === currentSlotIndex;
                const isFullHourOrHalf = hour.endsWith(":00") || hour.endsWith(":30");
                return (
                  <div
                    key={hour}
                    style={{
                      position: "absolute",
                      top: index * SLOT_HEIGHT,
                      left: 0,
                      right: 0,
                      height: SLOT_HEIGHT,
                      borderBottom: isFullHourOrHalf ? "1px solid #E2E8F0" : "1px dashed #F1F5F9",
                      padding: "4px 10px",
                      boxSizing: "border-box",
                      fontSize: 11,
                      color: isNow ? "#0F172A" : isFullHourOrHalf ? "#64748B" : "#CBD5E1",
                      fontWeight: isNow ? 800 : isFullHourOrHalf ? 700 : 500,
                      textAlign: "right",
                      background: isNow ? NOW_SLOT_BG : undefined,
                    }}
                  >
                    {hour}
                  </div>
                );
              })}
            </div>

            {/* Columnas de gabinetes */}
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

                // Marcamos celdillas ocupadas por citas activas. Cada durationSlot
                // operativo (30 min) ocupa 2 celdillas visuales (15 min cada una).
                const occupiedSlotIndexes = new Set<number>();
                appointmentsForGabinete.forEach((a) => {
                  if (a.status === "cancelled" || a.status === "suggested") return;
                  const idx = HOURS.indexOf(a.start);
                  if (idx === -1) return;
                  const cellSpan = Math.max(1, a.durationSlots) * 2;
                  for (let k = 0; k < cellSpan; k++) {
                    occupiedSlotIndexes.add(idx + k);
                  }
                });

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
                    {HOURS.map((hour, index) => {
                      const isFree = !occupiedSlotIndexes.has(index);
                      // Solo xx:00 y xx:30 son clickables para crear cita
                      // (la granularidad operativa sigue siendo 30 min).
                      const isOperativeStart = hour.endsWith(":00") || hour.endsWith(":30");
                      const slotClickable =
                        editable && Boolean(onEmptySlotClick) && isFree && isOperativeStart;
                      const isNow = index === currentSlotIndex;
                      const isFullHourOrHalf = hour.endsWith(":00") || hour.endsWith(":30");
                      return (
                        <div
                          key={`${gabinete}-${hour}`}
                          onClick={
                            slotClickable && onEmptySlotClick
                              ? () => onEmptySlotClick(gabinete, hour)
                              : undefined
                          }
                          style={{
                            position: "absolute",
                            top: index * SLOT_HEIGHT,
                            left: 0,
                            right: 0,
                            height: SLOT_HEIGHT,
                            borderBottom: isFullHourOrHalf
                              ? "1px solid #F1F5F9"
                              : "1px dashed #F8FAFC",
                            cursor: slotClickable ? "pointer" : "default",
                            transition: "background 120ms ease",
                            background: isNow ? NOW_SLOT_BG : undefined,
                          }}
                          onMouseEnter={(e) => {
                            if (!slotClickable) return;
                            e.currentTarget.style.background = "#F0FDFA";
                          }}
                          onMouseLeave={(e) => {
                            if (!slotClickable) return;
                            e.currentTarget.style.background = isNow ? NOW_SLOT_BG : "white";
                          }}
                        />
                      );
                    })}

                    {appointmentsForGabinete.map((appointment, index) => {
                      const slotIndex = HOURS.indexOf(appointment.start);
                      if (slotIndex === -1) return null;

                      // 1 durationSlot operativo (30 min) = 2 celdillas visuales (15 min)
                      const cellSpan = Math.max(1, appointment.durationSlots) * 2;
                      const top = slotIndex * SLOT_HEIGHT + 2;
                      const height = cellSpan * SLOT_HEIGHT - 4;
                      const style = getAppointmentStyle(appointment.status);
                      const isClickable = appointment.status !== "suggested";

                      return (
                        <div
                          key={`${gabinete}-${appointment.start}-${appointment.patient}-${index}`}
                          onClick={
                            isClickable ? () => setSelectedAppointment(appointment) : undefined
                          }
                          style={{
                            position: "absolute",
                            top,
                            left: 6,
                            right: 6,
                            height,
                            background: style.background,
                            border: `1px solid ${style.border}`,
                            borderRadius: 8,
                            padding: 6,
                            boxSizing: "border-box",
                            boxShadow: "0 2px 4px rgba(0,0,0,0.03)",
                            overflow: "hidden",
                            cursor: isClickable ? "pointer" : "default",
                            transition: "box-shadow 150ms ease, transform 150ms ease",
                          }}
                          onMouseEnter={(e) => {
                            if (!isClickable) return;
                            e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
                            e.currentTarget.style.transform = "translateY(-1px)";
                          }}
                          onMouseLeave={(e) => {
                            if (!isClickable) return;
                            e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.03)";
                            e.currentTarget.style.transform = "translateY(0)";
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "start",
                              justifyContent: "space-between",
                              gap: 6,
                              marginBottom: 2,
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

                          <div style={{ fontSize: 10, color: "#334155", lineHeight: 1.3 }}>
                            {appointment.type}
                          </div>

                          <div style={{ fontSize: 10, color: "#64748B", marginTop: 4 }}>
                            {appointment.start} · {appointment.durationSlots * 30} min · €
                            {appointment.value}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {selectedAppointment ? (
        <AppointmentDetailModal
          appointment={selectedAppointment}
          onClose={() => setSelectedAppointment(null)}
          editableMode={editable}
          gabinetesForMove={gabinetesForMove}
        />
      ) : null}
    </>
  );
}