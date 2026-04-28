"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveGabinete, deleteGabinete } from "./actions";

type Gabinete = {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
};

export default function GabinetesClient({ initialGabinetes }: { initialGabinetes: Gabinete[] }) {
  const router = useRouter();
  const [selectedGab, setSelectedGab] = useState<Gabinete | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [formData, setFormData] = useState({ name: "", description: "", active: true });

  const handleSelect = (gab: Gabinete) => {
    setSelectedGab(gab);
    setFormData({ name: gab.name, description: gab.description || "", active: gab.active });
    setFeedback(null);
  };

  const handleResetForm = () => {
    setSelectedGab(null);
    setFormData({ name: "", description: "", active: true });
    setFeedback(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setIsSaving(true);
    setFeedback(null);

    const result = await saveGabinete({
      id: selectedGab?.id,
      name: formData.name,
      description: formData.description,
      active: formData.active,
    });

    setIsSaving(false);

    if (result.success) {
      setFeedback({ type: "success", message: "Gabinete guardado correctamente." });
      handleResetForm();
      router.refresh();
    } else {
      setFeedback({ type: "error", message: result.error || "Error al guardar." });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("¿Estás seguro de que deseas eliminar este gabinete?")) return;

    setIsSaving(true);
    const result = await deleteGabinete(id);
    setIsSaving(false);

    if (result.success) {
      setFeedback({ type: "success", message: result.message || "Gabinete eliminado." });
      router.refresh();
    } else {
      setFeedback({ type: "error", message: result.error || "Error al eliminar." });
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 min-h-[500px]">
      <div className="col-span-2 border-r border-slate-200">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <h2 className="font-bold text-slate-800">Directorio de Gabinetes</h2>
          <button
            onClick={handleResetForm}
            className="text-sm bg-slate-800 text-white px-3 py-1.5 rounded-md hover:bg-slate-700 transition-colors"
          >
            + Nuevo Gabinete
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {initialGabinetes.map((gab) => (
            <div
              key={gab.id}
              className={`p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors ${selectedGab?.id === gab.id ? "bg-teal-50 hover:bg-teal-50" : ""}`}
              onClick={() => handleSelect(gab)}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800">{gab.name}</span>
                  {!gab.active && (
                    <span className="text-[10px] uppercase font-bold tracking-wider bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                      Inactivo
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 mt-1">{gab.description || "Sin descripción"}</p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(gab.id);
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
            </div>
          ))}

          {initialGabinetes.length === 0 && (
            <div className="p-8 text-center text-slate-500 text-sm">
              No hay gabinetes configurados.
            </div>
          )}
        </div>
      </div>

      <div className="bg-slate-50 p-6">
        <h3 className="font-bold text-slate-800 mb-6 border-b border-slate-200 pb-2">
          {selectedGab ? "Editar Gabinete" : "Crear Nuevo Gabinete"}
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
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none"
              placeholder="Ej. Gabinete 1"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Descripción (opcional)
            </label>
            <textarea
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none"
              placeholder="Ej. Exclusivo para implantes..."
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="activeCheckbox"
              checked={formData.active}
              onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
              className="h-4 w-4 text-teal-600 focus:ring-teal-500 border-slate-300 rounded"
            />
            <label htmlFor="activeCheckbox" className="text-sm font-medium text-slate-700">
              Gabinete Activo
            </label>
          </div>

          {feedback && (
            <div className={`p-3 rounded-lg text-sm mt-4 ${feedback.type === "success" ? "bg-teal-50 text-teal-700 border border-teal-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
              {feedback.message}
            </div>
          )}

          <div className="pt-6">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full bg-teal-600 text-white font-bold py-2.5 px-4 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
            >
              {isSaving ? "Guardando..." : "Guardar Gabinete"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}