"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Patient = { id: number; name: string };
type Dentist = { id: number; name: string };
type Treatment = { id: number; name: string; duration: number; price: number | null };
type Gabinete = { id: number; name: string };

type Props = {
  gabinete: Gabinete;
  startTime: string;
  date: string; // YYYY-MM-DD
  patients: Patient[];
  dentists: Dentist[];
  treatments: Treatment[];
  onClose: () => void;
};

export default function NewAppointmentModal({
  gabinete,
  startTime,
  date,
  patients,
  dentists,
  treatments,
  onClose,
}: Props) {
  const router = useRouter();
  const [patientId, setPatientId] = useState<string>("");
  const [dentistId, setDentistId] = useState<string>("");
  const [treatmentId, setTreatmentId] = useState<string>("");
  const [duration, setDuration] = useState<number>(30);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const treatmentsById = useMemo(() => {
    const m = new Map<number, Treatment>();
    treatments.forEach((t) => m.set(t.id, t));
    return m;
  }, [treatments]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleTreatmentChange = (val: string) => {
    setTreatmentId(val);
    const t = treatmentsById.get(Number(val));
    if (t) setDuration(t.duration);
  };

  async function handleSubmit() {
    if (!patientId || !dentistId || !treatmentId) {
      setError("Paciente, dentista y tratamiento son obligatorios");
      return;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      setError("Duración inválida");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: Number(patientId),
          dentistId: Number(dentistId),
          gabineteId: gabinete.id,
          treatmentTypeId: Number(treatmentId),
          date,
          startTime,
          duration,
        }),
      });

      if (!response.ok) {
        let msg = "No se pudo crear la cita";
        try {
          const body = (await response.json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch {
          // sin JSON
        }
        throw new Error(msg);
      }

      router.refresh();
      onClose();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-appointment-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-200 p-5">
          <div>
            <h2 id="new-appointment-modal-title" className="text-lg font-bold text-slate-900">
              Nueva cita
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {gabinete.name} · {startTime}
            </p>
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

        <div className="space-y-4 p-5 text-sm">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Paciente
            </label>
            <select
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              className="w-full p-2 border rounded bg-white"
              required
            >
              <option value="">Selecciona paciente</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Dentista
            </label>
            <select
              value={dentistId}
              onChange={(e) => setDentistId(e.target.value)}
              className="w-full p-2 border rounded bg-white"
              required
            >
              <option value="">Selecciona dentista</option>
              {dentists.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Tratamiento
            </label>
            <select
              value={treatmentId}
              onChange={(e) => handleTreatmentChange(e.target.value)}
              className="w-full p-2 border rounded bg-white"
              required
            >
              <option value="">Selecciona tratamiento</option>
              {treatments.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.duration} min · €{t.price ?? 0})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Duración (min)
            </label>
            <input
              type="number"
              min={15}
              step={15}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value) || 30)}
              className="w-full p-2 border rounded bg-white"
              required
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Auto-rellenado al elegir tratamiento. Editable.
            </p>
          </div>
        </div>

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
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="rounded-md bg-teal-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Creando..." : "Crear cita"}
          </button>
        </div>
      </div>
    </div>
  );
}