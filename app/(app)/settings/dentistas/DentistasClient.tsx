"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveDentist, deleteDentist } from "./actions";

type Dentist = {
  id: number;
  name: string;
  specialty: string | null;
  active: boolean;
};

type Props = {
  initialDentistas: Dentist[];
};

export default function DentistasClient({ initialDentistas }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Dentist | null>(null);
  const [formData, setFormData] = useState({ name: "", specialty: "", active: true });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    const res = await saveDentist({ ...formData, id: selected?.id });
    setIsSaving(false);
    if (res.success) {
      setSelected(null);
      setFormData({ name: "", specialty: "", active: true });
      router.refresh();
    } else {
      setError(res.error || "Error al guardar.");
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 min-h-[500px]">
      <div className="col-span-2 border-r border-slate-200">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <h2 className="font-bold text-slate-800">Cuerpo Médico</h2>
          <button
            onClick={() => {
              setSelected(null);
              setFormData({ name: "", specialty: "", active: true });
              setError(null);
            }}
            className="text-sm bg-slate-800 text-white px-3 py-1.5 rounded-md"
          >
            + Nuevo
          </button>
        </div>
        <div className="divide-y divide-slate-100">
          {initialDentistas.map((d) => (
            <div
              key={d.id}
              onClick={() => {
                setSelected(d);
                setFormData({ name: d.name, specialty: d.specialty || "", active: d.active });
                setError(null);
              }}
              className={`p-4 cursor-pointer hover:bg-slate-50 ${selected?.id === d.id ? "bg-teal-50" : ""}`}
            >
              <div className="font-bold">
                {d.name} {!d.active && " (Inactivo)"}
              </div>
              <div className="text-sm text-slate-500">{d.specialty || "General"}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="p-6 bg-slate-50">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h3 className="font-bold mb-4">{selected ? "Editar" : "Nuevo"} Doctor/a</h3>
          <input
            type="text"
            placeholder="Nombre completo"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full p-2 border rounded"
            required
          />
          <input
            type="text"
            placeholder="Especialidad"
            value={formData.specialty}
            onChange={(e) => setFormData({ ...formData, specialty: e.target.value })}
            className="w-full p-2 border rounded"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={formData.active}
              onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
            />{" "}
            Activo
          </label>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSaving}
            className="w-full bg-teal-600 text-white p-2 rounded font-bold disabled:opacity-60"
          >
            {isSaving ? "Cargando..." : "Guardar"}
          </button>
          {selected && (
            <button
              type="button"
              onClick={() => {
                if (!confirm("¿Eliminar este dentista?")) return;
                deleteDentist(selected.id).then(() => {
                  setSelected(null);
                  setFormData({ name: "", specialty: "", active: true });
                  router.refresh();
                });
              }}
              className="w-full text-red-500 text-sm mt-2"
            >
              Eliminar Dentista
            </button>
          )}
        </form>
      </div>
    </div>
  );
}