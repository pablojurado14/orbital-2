import { withClinic } from "@/lib/tenant-prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import GabinetesClient from "./GabinetesClient";

export default async function GabinetesPage() {
  const clinicId = await getCurrentClinicId();
  const gabinetes = await withClinic(clinicId, (tx) =>
    tx.gabinete.findMany({
      where: { clinicId },
      orderBy: { name: "asc" },
    }),
  );
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <GabinetesClient initialGabinetes={gabinetes} />
    </div>
  );
}