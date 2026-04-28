import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import GabinetesClient from "./GabinetesClient";

export default async function GabinetesPage() {
  const gabinetes = await prisma.gabinete.findMany({
    where: { clinicId: getCurrentClinicId() },
    orderBy: { name: "asc" },
  });
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <GabinetesClient initialGabinetes={gabinetes} />
    </div>
  );
}