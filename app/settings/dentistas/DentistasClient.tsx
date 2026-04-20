"use client";

import { useState } from "react";
import { saveDentist, deleteDentist } from "./actions";

export default function DentistasClient({ initialDentistas }: { initialDentistas: any[] }) {
  const [selected, setSelected] = useState<any>(null);
  const [formData, setFormData] = useState({ name: "", specialty: "", active: true });
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    const res = await saveDentist({ ...formData, id: selected?.id });
    if (res.success) window.location.reload();
    else { alert(res.error); setIsSaving(false); }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 min-h-[500px]">
      <div className="col-span-2 border-r border-slate-200">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <h2 className="font-bold text-slate-800">Cuerpo Médico</h2>
          <button onClick={() => { setSelected(null); setFormData({name:"", specialty:"", active:true}); }} className="text-sm bg-slate-800 text-white px-3 py-1.5 rounded-md">+ Nuevo</button>
        </div>
        <div className="divide-y divide-slate-100">
          {initialDentistas.map((d) => (
            <div key={d.id} onClick={() => { setSelected(d); setFormData({name: d.name, specialty: d.specialty || "", active: d.active}); }} className={`p-4 cursor-pointer hover:bg-slate-50 ${selected?.id === d.id ? "bg-teal-50" : ""}`}>
              <div className="font-bold">{d.name} {!d.active && " (Inactivo)"}</div>
              <div className="text-sm text-slate-500">{d.specialty || "General"}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="p-6 bg-slate-50">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h3 className="font-bold mb-4">{selected ? "Editar" : "Nuevo"} Doctor/a</h3>
          <input type="text" placeholder="Nombre completo" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-2 border rounded" required />
          <input type="text" placeholder="Especialidad" value={formData.specialty} onChange={e => setFormData({...formData, specialty: e.target.value})} className="w-full p-2 border rounded" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={formData.active} onChange={e => setFormData({...formData, active: e.target.checked})} /> Activo</label>
          <button type="submit" disabled={isSaving} className="w-full bg-teal-600 text-white p-2 rounded font-bold">{isSaving ? "Cargando..." : "Guardar"}</button>
          {selected && (
            <button type="button" onClick={() => deleteDentist(selected.id).then(() => window.location.reload())} className="w-full text-red-500 text-sm mt-2">Eliminar Dentista</button>
          )}
        </form>
      </div>
    </div>
  );
}
