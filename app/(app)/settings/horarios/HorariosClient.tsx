"use client";

import { useState } from "react";
import { saveHorario } from "./actions";

type Schedule = {
  id: number;
  dayOfWeek: number;
  isOpen: boolean;
  morningOpen: string | null;
  morningClose: string | null;
  afternoonOpen: string | null;
  afternoonClose: string | null;
  clinicId: number;
};

type Feedback = {
  id: number;
  type: "success" | "error";
  message: string;
};

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// Orden L-M-X-J-V-S-D para mostrar (más natural que 0-6)
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function HorariosClient({
  initialSchedules,
  clinicName,
}: {
  initialSchedules: Schedule[];
  clinicName: string;
}) {
  const [schedules, setSchedules] = useState<Schedule[]>(initialSchedules);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const updateLocal = (id: number, patch: Partial<Schedule>) => {
    setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const handleSave = async (schedule: Schedule) => {
    setSavingId(schedule.id);
    setFeedback(null);
    const res = await saveHorario({
      id: schedule.id,
      isOpen: schedule.isOpen,
      morningOpen: schedule.morningOpen,
      morningClose: schedule.morningClose,
      afternoonOpen: schedule.afternoonOpen,
      afternoonClose: schedule.afternoonClose,
    });
    setSavingId(null);

    if (res.success) {
      setFeedback({ id: schedule.id, type: "success", message: "Horario guardado" });
      // Auto-clear tras 3 segundos
      setTimeout(() => {
        setFeedback((current) => (current?.id === schedule.id ? null : current));
      }, 3000);
    } else {
      setFeedback({
        id: schedule.id,
        type: "error",
        message: res.error || "Error al guardar el horario",
      });
    }
  };

  const orderedSchedules = DISPLAY_ORDER.map((dow) => schedules.find((s) => s.dayOfWeek === dow)).filter(
    Boolean
  ) as Schedule[];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="font-bold text-slate-800 text-lg">{clinicName}</h2>
        <p className="text-sm text-slate-500 mt-1">
          Define el horario semanal de apertura. Los cambios por día se guardan de forma independiente.
        </p>
      </div>

      <div className="space-y-3">
        {orderedSchedules.map((s) => (
          <div key={s.id} className="space-y-2">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-1 md:grid-cols-[120px_auto_1fr_auto] gap-4 items-center">
              <div className="font-bold text-slate-800">{DAY_NAMES[s.dayOfWeek]}</div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.isOpen}
                  onChange={(e) => updateLocal(s.id, { isOpen: e.target.checked })}
                  className="h-4 w-4"
                />
                {s.isOpen ? "Abierto" : "Cerrado"}
              </label>

              <div className={`flex flex-wrap gap-2 items-center ${!s.isOpen ? "opacity-40 pointer-events-none" : ""}`}>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-500">Mañana:</span>
                  <input type="time" value={s.morningOpen ?? ""} onChange={(e) => updateLocal(s.id, { morningOpen: e.target.value || null })} className="px-2 py-1 border rounded text-sm" />
                  <span>–</span>
                  <input type="time" value={s.morningClose ?? ""} onChange={(e) => updateLocal(s.id, { morningClose: e.target.value || null })} className="px-2 py-1 border rounded text-sm" />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-500">Tarde:</span>
                  <input type="time" value={s.afternoonOpen ?? ""} onChange={(e) => updateLocal(s.id, { afternoonOpen: e.target.value || null })} className="px-2 py-1 border rounded text-sm" />
                  <span>–</span>
                  <input type="time" value={s.afternoonClose ?? ""} onChange={(e) => updateLocal(s.id, { afternoonClose: e.target.value || null })} className="px-2 py-1 border rounded text-sm" />
                </div>
              </div>

              <button
                onClick={() => handleSave(s)}
                disabled={savingId === s.id}
                className="bg-teal-600 text-white font-bold text-sm px-4 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50"
              >
                {savingId === s.id ? "..." : "Guardar"}
              </button>
            </div>

            {feedback && feedback.id === s.id ? (
              <div
                className={`text-sm px-3 py-2 rounded-md border ${
                  feedback.type === "success"
                    ? "bg-green-50 border-green-200 text-green-700"
                    : "bg-red-50 border-red-200 text-red-700"
                }`}
              >
                {feedback.message}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}