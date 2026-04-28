import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import PacientesClient from "./PacientesClient";

export const dynamic = "force-dynamic";

export default async function PacientesPage() {
  const clinicId = getCurrentClinicId();

  const [patients, gabinetes, dentistas, treatments] = await Promise.all([
    prisma.patient.findMany({ where: { clinicId }, orderBy: { name: "asc" } }),
    prisma.gabinete.findMany({ where: { clinicId, active: true }, orderBy: { name: "asc" } }),
    prisma.dentist.findMany({ where: { clinicId, active: true }, orderBy: { name: "asc" } }),
    prisma.treatmentType.findMany({ where: { clinicId, active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <PacientesClient
      initialPatients={patients}
      gabinetes={gabinetes}
      dentistas={dentistas}
      treatments={treatments}
    />
  );
}