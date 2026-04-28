"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getStatusLabel } from "@/lib/orbital-engine";
import { HOURS } from "@/data/mock";

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
  appointment: Appointment;
  onClose: () => void;
  editableMode?: boolean;
  gabinetesForMove?: { id: number; name: string }[];
};

export default function AppointmentDetailModal({
  appointment,
  onClose,
  editableMode = false,
  gabinetesForMove,
}: Props) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCancel =
    appointment.id !== undefined &&
    appointment.status !== "cancelled" &&
    appointment.status !== "suggested";

  const canMove =
    editableMode &&
    appointment.id !== undefined &&
    appointment.status !== "cancelled" &&
    appointment.status !== "suggested" &&
    !!gabinetesForMove &&
    gabinetesForMove.length > 0;

  const initialGabineteId = useMemo(() => {
    if (!gabinetesForMove) return "";
    const found = gabinetesForMove.find((g) => g.name === appointment.gabinete);
    return found ? String(found.id) : "";
  }, [gabinetesForMove, appointment.gabinete]);

  const [moveGabineteId, setMoveGabineteId] = useState<string>(initialGabineteId);
  const [moveStartTime, setMoveStartTime] = useState<string>(appointment.start);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleCancel() {
    if (appointment.id === undefined) return;
    setError(null);
    setCancelling(true);
    try {
      const response = await fetch("/api/appointments/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: appointment.id }),
      });

      if (!response.ok) {
        let errorMessage = "No se pudo cancelar la cita";
        try {
          const body = (await response.json()) as { error?: string };
          if (body?.error) errorMessage = body.error;
        } catch {
          // Cuerpo sin JSON válido — mantener mensaje genérico
        }

        if (response.status === 400 && errorMessage.includes("ya está cancelada")) {
          router.refresh();
          onClose();
          return;
        }

        throw new Error(errorMessage);
      }

      router.refresh();
      onClose();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setCancelling(false);
    }
  }

  async function handleMove() {
    if (appointment.id === undefined) return;
    if (!moveGabineteId) {
      setError("Selecciona un gabinete destino");
      return;
    }
    setError(null);
    setMoving(true);
    try {
      // Asumimos "hoy" porque /citas Fase 1 solo muestra el día actual.
      // Cuando haya navegación de días, esta fecha se pasa por prop al modal.
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      const dateStr = `${yyyy}-${mm}-${dd}`;

      const response = await fetch(`/api/appointments/${appointment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: dateStr,
          startTime: moveStartTime,
          gabineteId: Number(moveGabineteId),
        }),
      });

      if (!response.ok) {
        let errorMessage = "No se pudo mover la cita";
        try {
          const body = (await response.json()) as { error?: string };
          if (body?.error) errorMessage = body.error;
        } catch {
          // sin JSON
        }
        throw new Error(errorMessage);
      }

      router.refresh();
      onClose();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setMoving(false);
    }
  }

  const isMoveChanged =
    moveGabineteId !== initialGabineteId || moveStartTime !== appointment.start;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="appointment-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-200 p-5">
          <div>
            <h2 id="appointment-modal-title" className="text-lg font-bold text-slate-900">
              {appointment.patient}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">{appointment.type}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>

        <div className="space-y-3 p-5 text-sm">
          <div className="flex justify-between">
            <span className="font-medium text-slate-500">Estado</span>
            <span className="font-semibold text-slate-900">
              {getStatusLabel(appointment.status)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium text-slate-500">Hora</span>
            <span className="font-semibold text-slate-900">
              {appointment.start} · {appointment.durationSlots * 30} min
            </span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium text-slate-500">Gabinete</span>
            <span className="font-semibold text-slate-900">{appointment.gabinete}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium text-slate-500">Valor</span>
            <span className="font-semibold text-slate-900">€{appointment.value}</span>
          </div>
        </div>

        {canMove ? (
          <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              Mover cita
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Gabinete
                </label>
                <select
                  value={moveGabineteId}
                  onChange={(e) => setMoveGabineteId(e.target.value)}
                  className="w-full p-2 border rounded text-sm bg-white"
                >
                  {gabinetesForMove!.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Hora
                </label>
                <select
                  value={moveStartTime}
                  onChange={(e) => setMoveStartTime(e.target.value)}
                  className="w-full p-2 border rounded text-sm bg-white"
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleMove()}
              disabled={moving || !isMoveChanged}
              className="mt-3 w-full rounded-md bg-teal-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {moving ? "Moviendo..." : isMoveChanged ? "Mover cita" : "Sin cambios"}
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="mx-5 mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 rounded-b-xl border-t border-slate-200 bg-slate-50 p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
          >
            Cerrar
          </button>

          {canCancel ? (
            <button
              type="button"
              onClick={() => void handleCancel()}
              disabled={cancelling}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancelling ? "Cancelando..." : "Cancelar cita"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}