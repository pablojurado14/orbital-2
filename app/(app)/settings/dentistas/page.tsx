import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import DentistasClient from "./DentistasClient";

export const dynamic = "force-dynamic";

export default async function DentistasPage() {
  const dentistas = await prisma.dentist.findMany({
    where: { clinicId: getCurrentClinicId() },
    orderBy: { name: "asc" },
  });
  return <DentistasClient initialDentistas={dentistas} />;
}