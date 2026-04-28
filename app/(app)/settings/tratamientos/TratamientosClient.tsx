"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveTratamiento, deleteTratamiento } from "./actions";

type Tratamiento = {
  id: number;
  name: string;
  duration: number;
  price: number | null;
  active: boolean;
};

export default function TratamientosClient({ initialTratamientos }: { initialTratamientos: Tratamiento[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Tratamiento | null>(null);
  const [formData, setFormData] = useState({ name: "", duration: 30, price: "", active: true });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    const res = await saveTratamiento({
      id: selected?.id,
      name: formData.name,
      duration: Number(formData.duration),
      price: formData.price ? Number(formData.price) : null,
      active: formData.active,
    });
    setIsSaving(false);
    if (res.success) {
      setSelected(null);
      setFormData({ name: "", duration: 30, price: "", active: true });
      router.refresh();
    } else {
      setError(res.error || "Error al guardar.");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar este tratamiento?")) return;
    setIsSaving(true);
    const res = await deleteTratamiento(id);
    setIsSaving(false);
    if (res.success) {
      setSelected(null);
      setFormData({ name: "", duration: 30, price: "", active: true });
      router.refresh();
    } else {
      setError(res.error || "Error al eliminar.");
    }
  };

  const handleResetForm = () => {
    setSelected(null);
    setFormData({ name: "", duration: 30, price: "", active: true });
    setError(null);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 min-h-[500px]">
      <div className="col-span-2 border-r border-slate-200">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <h2 className="font-bold text-slate-800">Catálogo de Tratamientos</h2>
          <button onClick={handleResetForm} className="text-sm bg-slate-800 text-white px-3 py-1.5 rounded-md">
            + Nuevo
          </button>
        </div>
        <div className="divide-y divide-slate-100">
          {initialTratamientos.map((t) => (
            <div
              key={t.id}
              onClick={() => {
                setSelected(t);
                setFormData({
                  name: t.name,
                  duration: t.duration,
                  price: t.price?.toString() ?? "",
                  active: t.active,
                });
                setError(null);
              }}
              className={`p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 ${selected?.id === t.id ? "bg-teal-50" : ""}`}
            >
              <div>
                <div className="font-bold text-slate-900">
                  {t.name} {!t.active && <span className="text-xs text-red-500 ml-1">(inactivo)</span>}
                </div>
                <div className="text-sm text-slate-500">
                  {t.duration} min · €{t.price ?? "—"}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(t.id);
                }}
                className="text-slate-400 hover:text-red-500 p-2"
                title="Eliminar"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18"></path>
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          ))}

          {initialTratamientos.length === 0 && (
            <div className="p-8 text-center text-slate-500 text-sm">No hay tratamientos configurados.</div>
          )}
        </div>
      </div>

      <div className="bg-slate-50 p-6">
        <h3 className="font-bold text-slate-800 mb-6 border-b border-slate-200 pb-2">
          {selected ? "Editar Tratamiento" : "Crear Tratamiento"}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              placeholder="Ej. Revisión"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Duración (min) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              required
              min={5}
              step={5}
              value={formData.duration}
              onChange={(e) => setFormData({ ...formData, duration: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <p className="text-xs text-slate-400 mt-1">Se redondea a slots de 30 min en la agenda.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Precio (€)</label>
            <input
              type="number"
              min={0}
              step={1}
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              placeholder="Opcional"
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="tratActive"
              checked={formData.active}
              onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
              className="h-4 w-4 text-teal-600 border-slate-300 rounded"
            />
            <label htmlFor="tratActive" className="text-sm font-medium text-slate-700">
              Activo
            </label>
          </div>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSaving}
            className="w-full bg-teal-600 text-white font-bold py-2.5 px-4 rounded-lg hover:bg-teal-700 disabled:opacity-50"
          >
            {isSaving ? "Guardando..." : "Guardar"}
          </button>
        </form>
      </div>
    </div>
  );
}