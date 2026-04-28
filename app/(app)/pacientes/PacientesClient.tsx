"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { savePatient } from "./actions";

type Treatment = {
  id: number;
  name: string;
  duration: number;
  price: number | null;
};

type Gabinete = { id: number; name: string };
type Dentist = { id: number; name: string };

type Patient = {
  id: number;
  name: string;
  phone: string | null;
  inWaitingList: boolean;
  preferredGabineteId: number | null;
  preferredDentistId: number | null;
  waitingTreatmentId: number | null;
  waitingDurationSlots: number | null;
  waitingValue: number | null;
  priority: number;
  availableNow: boolean;
  easeScore: number;
};

type Props = {
  initialPatients: Patient[];
  gabinetes: Gabinete[];
  dentistas: Dentist[];
  treatments: Treatment[];
};

type FormState = {
  name: string;
  phone: string;
  inWaitingList: boolean;
  preferredGabineteId: string;
  preferredDentistId: string;
  waitingTreatmentId: string;
  waitingDurationSlots: number;
  waitingValue: number;
  priority: number;
  availableNow: boolean;
  easeScore: number;
};

const EMPTY_FORM: FormState = {
  name: "",
  phone: "",
  inWaitingList: false,
  preferredGabineteId: "",
  preferredDentistId: "",
  waitingTreatmentId: "",
  waitingDurationSlots: 1,
  waitingValue: 0,
  priority: 3,
  availableNow: true,
  easeScore: 3,
};

export default function PacientesClient({
  initialPatients,
  gabinetes,
  dentistas,
  treatments,
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Patient | null>(null);
  const [formData, setFormData] = useState<FormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const treatmentsById = useMemo(() => {
    const map = new Map<number, Treatment>();
    treatments.forEach((t) => map.set(t.id, t));
    return map;
  }, [treatments]);

  const isPristine =
    !selected && JSON.stringify(formData) === JSON.stringify(EMPTY_FORM);

  const handleTreatmentChange = (treatmentId: string) => {
    const id = Number(treatmentId);
    const t = treatmentsById.get(id);
    setFormData((f) => ({
      ...f,
      waitingTreatmentId: treatmentId,
      waitingDurationSlots: t ? Math.max(1, Math.round(t.duration / 30)) : f.waitingDurationSlots,
      waitingValue: t?.price ?? f.waitingValue,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    const res = await savePatient({
      id: selected?.id,
      name: formData.name,
      phone: formData.phone || null,
      inWaitingList: formData.inWaitingList,
      preferredGabineteId: formData.preferredGabineteId ? Number(formData.preferredGabineteId) : null,
      preferredDentistId: formData.preferredDentistId ? Number(formData.preferredDentistId) : null,
      waitingTreatmentId:
        formData.inWaitingList && formData.waitingTreatmentId
          ? Number(formData.waitingTreatmentId)
          : null,
      waitingDurationSlots: formData.inWaitingList ? formData.waitingDurationSlots : null,
      waitingValue: formData.inWaitingList ? formData.waitingValue : null,
      priority: formData.inWaitingList ? formData.priority : 1,
      availableNow: formData.inWaitingList ? formData.availableNow : true,
      easeScore: formData.inWaitingList ? formData.easeScore : 5,
    });
    setIsSaving(false);
    if (res.success) {
      setSelected(null);
      setFormData(EMPTY_FORM);
      router.refresh();
    } else {
      setError(res.error || "Error al guardar el paciente.");
    }
  };

  const loadPatientToForm = (p: Patient) => {
    setSelected(p);
    setError(null);
    setFormData({
      name: p.name ?? "",
      phone: p.phone ?? "",
      inWaitingList: p.inWaitingList ?? false,
      preferredGabineteId: p.preferredGabineteId?.toString() || "",
      preferredDentistId: p.preferredDentistId?.toString() || "",
      waitingTreatmentId: p.waitingTreatmentId?.toString() || "",
      waitingDurationSlots: p.waitingDurationSlots ?? 1,
      waitingValue: p.waitingValue ?? 0,
      priority: p.priority ?? 3,
      availableNow: p.availableNow ?? true,
      easeScore: p.easeScore ?? 3,
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 min-h-[500px]">
      <div className="col-span-2 border-r border-slate-200">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <h2 className="font-bold text-slate-800">Directorio ({initialPatients.length})</h2>
          <button
            onClick={() => {
              if (isPristine) return;
              setSelected(null);
              setFormData(EMPTY_FORM);
              setError(null);
            }}
            disabled={isPristine}
            title={isPristine ? "Ya estás en modo alta" : "Limpiar formulario y empezar nuevo"}
            className={`text-sm px-3 py-1.5 rounded-md font-bold transition-opacity ${
              isPristine
                ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                : "bg-teal-600 text-white hover:bg-teal-700"
            }`}
          >
            + Nuevo Paciente
          </button>
        </div>
        <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
          {initialPatients.map((p) => (
            <div
              key={p.id}
              onClick={() => loadPatientToForm(p)}
              className={`p-4 cursor-pointer hover:bg-slate-50 flex items-center justify-between ${
                selected?.id === p.id ? "bg-teal-50" : ""
              }`}
            >
              <div>
                <div className="font-bold text-slate-900">{p.name}</div>
                <div className="text-sm text-slate-500">{p.phone || "Sin teléfono"}</div>
              </div>
              {p.inWaitingList && (
                <span className="bg-orange-100 text-orange-700 text-[10px] font-black px-2 py-1 rounded-full uppercase tracking-tighter">
                  En espera
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="p-6 bg-slate-50 max-h-[700px] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h3 className="font-bold text-slate-800 mb-4">{selected ? "Ficha Paciente" : "Alta de Paciente"}</h3>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Nombre Completo</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full p-2 border rounded mt-1 bg-white"
              required
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Teléfono (opcional)</label>
            <input
              type="text"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full p-2 border rounded mt-1 bg-white"
            />
          </div>

          <div className="pt-2">
            <label className="flex items-center gap-3 p-3 bg-white border rounded-xl cursor-pointer hover:border-orange-300 transition-colors">
              <input
                type="checkbox"
                checked={formData.inWaitingList}
                onChange={(e) => setFormData({ ...formData, inWaitingList: e.target.checked })}
                className="w-5 h-5 accent-orange-500"
              />
              <span className="text-sm font-bold text-slate-700">Añadir a lista de espera</span>
            </label>
          </div>

          {formData.inWaitingList && (
            <div className="space-y-3 pt-2 border-t border-slate-200">
              <h4 className="text-[10px] font-black text-orange-500 uppercase tracking-widest pt-2">
                Datos para el motor
              </h4>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Tratamiento</label>
                <select
                  value={formData.waitingTreatmentId}
                  onChange={(e) => handleTreatmentChange(e.target.value)}
                  className="w-full p-2 border rounded text-sm bg-white mt-1"
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">Duración (slots)</label>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={formData.waitingDurationSlots}
                    onChange={(e) =>
                      setFormData({ ...formData, waitingDurationSlots: Number(e.target.value) || 1 })
                    }
                    className="w-full p-2 border rounded text-sm bg-white mt-1"
                    required
                  />
                  <p className="text-[10px] text-slate-400 mt-1">1 slot = 30 min</p>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">Valor (€)</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={formData.waitingValue}
                    onChange={(e) =>
                      setFormData({ ...formData, waitingValue: Number(e.target.value) || 0 })
                    }
                    className="w-full p-2 border rounded text-sm bg-white mt-1"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">Prioridad (1-5)</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: Number(e.target.value) })}
                    className="w-full p-2 border rounded text-sm bg-white mt-1"
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">Facilidad (1-5)</label>
                  <select
                    value={formData.easeScore}
                    onChange={(e) => setFormData({ ...formData, easeScore: Number(e.target.value) })}
                    className="w-full p-2 border rounded text-sm bg-white mt-1"
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm pt-1">
                <input
                  type="checkbox"
                  checked={formData.availableNow}
                  onChange={(e) => setFormData({ ...formData, availableNow: e.target.checked })}
                  className="w-4 h-4 accent-teal-600"
                />
                <span className="text-slate-700 font-medium">Disponible ahora (acepta avisos cortos)</span>
              </label>
            </div>
          )}

          <div className="space-y-3 pt-2 border-t border-slate-200">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest pt-2">
              Preferencias Operativas
            </h4>
            <select
              value={formData.preferredGabineteId}
              onChange={(e) => setFormData({ ...formData, preferredGabineteId: e.target.value })}
              className="w-full p-2 border rounded text-sm bg-white"
            >
              <option value="">Cualquier gabinete</option>
              {gabinetes.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>

            <select
              value={formData.preferredDentistId}
              onChange={(e) => setFormData({ ...formData, preferredDentistId: e.target.value })}
              className="w-full p-2 border rounded text-sm bg-white"
            >
              <option value="">Cualquier doctor</option>
              {dentistas.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSaving}
            className="w-full bg-slate-900 text-white p-3 rounded-xl font-bold mt-4 shadow-lg active:scale-95 transition-all disabled:opacity-60"
          >
            {isSaving ? "Guardando..." : "Guardar Ficha"}
          </button>
        </form>
      </div>
    </div>
  );
}