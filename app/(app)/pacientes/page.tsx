import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import PacientesClient from "./PacientesClient";

export const dynamic = "force-dynamic";

export default async function PacientesPage() {
  const clinicId = getCurrentClinicId();

  const [pacientes, gabinetes, dentistas, treatments] = await Promise.all([
    prisma.patient.findMany({
      where: { clinicId, active: true },
      include: {
        waitlistEntries: {
          where: { clinicId },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.gabinete.findMany({ where: { clinicId, active: true }, orderBy: { name: "asc" } }),
    prisma.dentist.findMany({ where: { clinicId, active: true }, orderBy: { name: "asc" } }),
    prisma.treatmentType.findMany({ where: { clinicId, active: true }, orderBy: { name: "asc" } }),
  ]);

  const initialPatients = pacientes.map((p) => {
    const entry = p.waitlistEntries[0] ?? null;
    return {
      id: p.id,
      name: p.name,
      phone: p.phone,
      preferredGabineteId: p.preferredGabineteId,
      preferredDentistId: p.preferredDentistId,
      inWaitingList: entry !== null,
      waitlistEntryId: entry?.id ?? null,
      waitingTreatmentId: entry?.desiredTreatmentTypeId ?? null,
      waitingDurationSlots: entry?.durationSlots ?? null,
      waitingValue: entry?.value ?? null,
      priority: entry?.priority ?? 3,
      availableNow: entry?.availableNow ?? true,
      easeScore: entry?.easeScore ?? 3,
    };
  });

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Base de Pacientes</h1>
        <p className="text-slate-600">Gestiona los pacientes y su estado en la lista de espera.</p>
      </header>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <PacientesClient
          initialPatients={initialPatients}
          gabinetes={gabinetes}
          dentistas={dentistas}
          treatments={treatments}
        />
      </div>
    </div>
  );
}