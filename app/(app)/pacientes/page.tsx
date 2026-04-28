import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import PacientesClient from "./PacientesClient";

export const dynamic = "force-dynamic";

export default async function PacientesPage() {
  const clinicId = getCurrentClinicId();

  const [pacientes, gabinetes, dentistas, treatments] = await Promise.all([
    prisma.patient.findMany({ where: { clinicId }, orderBy: { name: "asc" } }),
    prisma.gabinete.findMany({ where: { clinicId, active: true }, orderBy: { name: "asc" } }),
    prisma.dentist.findMany({ where: { clinicId, active: true }, orderBy: { name: "asc" } }),
    prisma.treatmentType.findMany({ where: { clinicId, active: true }, orderBy: { name: "asc" } }),
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