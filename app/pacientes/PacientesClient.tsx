"use client";

import { useState } from "react";
import { savePatient } from "./actions";

export default function PacientesClient({ initialPatients, gabinetes, dentistas }: any) {
  const [selected, setSelected] = useState<any>(null);
  const [formData, setFormData] = useState({ 
    name: "", phone: "", inWaitingList: false, preferredGabineteId: "", preferredDentistId: ""
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    const res = await savePatient({ 
      ...formData, 
      id: selected?.id,
      preferredGabineteId: formData.preferredGabineteId ? Number(formData.preferredGabineteId) : null,
      preferredDentistId: formData.preferredDentistId ? Number(formData.preferredDentistId) : null
    });
    if (res.success) window.location.reload();
    else { alert(res.error); setIsSaving(false); }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 min-h-[500px]">
      <div className="col-span-2 border-r border-slate-200">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <h2 className="font-bold text-slate-800">Directorio ({initialPatients.length})</h2>
          <button 
            onClick={() => { setSelected(null); setFormData({name:"", phone:"", inWaitingList:false, preferredGabineteId:"", preferredDentistId:""}); }}
            className="text-sm bg-teal-600 text-white px-3 py-1.5 rounded-md font-bold"
          >
            + Nuevo Paciente
          </button>
        </div>
        <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
          {initialPatients.map((p: any) => (
            <div 
              key={p.id} 
              onClick={() => {
                setSelected(p);
                setFormData({
                  name: p.name, 
                  phone: p.phone, 
                  inWaitingList: p.inWaitingList,
                  preferredGabineteId: p.preferredGabineteId?.toString() || "",
                  preferredDentistId: p.preferredDentistId?.toString() || ""
                });
              }}
              className={`p-4 cursor-pointer hover:bg-slate-50 flex items-center justify-between ${selected?.id === p.id ? "bg-teal-50" : ""}`}
            >
              <div>
                <div className="font-bold text-slate-900">{p.name}</div>
                <div className="text-sm text-slate-500">{p.phone}</div>
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

      <div className="p-6 bg-slate-50">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h3 className="font-bold text-slate-800 mb-4">{selected ? "Ficha Paciente" : "Alta de Paciente"}</h3>
          
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Nombre Completo</label>
            <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-2 border rounded mt-1 bg-white" required />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Teléfono</label>
            <input type="text" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full p-2 border rounded mt-1 bg-white" required />
          </div>

          <div className="pt-2">
            <label className="flex items-center gap-3 p-3 bg-white border rounded-xl cursor-pointer hover:border-orange-300 transition-colors">
              <input 
                type="checkbox" 
                checked={formData.inWaitingList}
                onChange={e => setFormData({...formData, inWaitingList: e.target.checked})}
                className="w-5 h-5 accent-orange-500"
              />
              <span className="text-sm font-bold text-slate-700">Añadir a lista de espera</span>
            </label>
          </div>
          
          <div className="space-y-3 pt-2">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Preferencias Operativas</h4>
            <select 
              value={formData.preferredGabineteId} 
              onChange={e => setFormData({...formData, preferredGabineteId: e.target.value})}
              className="w-full p-2 border rounded text-sm bg-white"
            >
              <option value="">Cualquier gabinete</option>
              {gabinetes.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>

            <select 
              value={formData.preferredDentistId} 
              onChange={e => setFormData({...formData, preferredDentistId: e.target.value})}
              className="w-full p-2 border rounded text-sm bg-white"
            >
              <option value="">Cualquier doctor</option>
              {dentistas.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          <button type="submit" disabled={isSaving} className="w-full bg-slate-900 text-white p-3 rounded-xl font-bold mt-4 shadow-lg active:scale-95 transition-all">
            {isSaving ? "Guardando..." : "Guardar Ficha"}
          </button>
        </form>
      </div>
    </div>
  );
}
