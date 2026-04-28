import { prisma } from "@/lib/prisma";
import PacientesClient from "./PacientesClient";

export default async function PacientesPage() {
  const [pacientes, gabinetes, dentistas, treatments] = await Promise.all([
    prisma.patient.findMany({ orderBy: { name: "asc" } }),
    prisma.gabinete.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.dentist.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.treatmentType.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Base de Pacientes</h1>
        <p className="text-slate-600">Gestiona los pacientes y su estado en la lista de espera.</p>
      </header>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <PacientesClient
          initialPatients={pacientes}
          gabinetes={gabinetes}
          dentistas={dentistas}
          treatments={treatments}
        />
      </div>
    </div>
  );
}