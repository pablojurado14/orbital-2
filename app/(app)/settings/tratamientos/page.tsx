import { withClinic } from "@/lib/tenant-prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import TratamientosClient from "./TratamientosClient";

export default async function TratamientosPage() {
  const clinicId = await getCurrentClinicId();
  const tratamientos = await withClinic(clinicId, (tx) =>
    tx.treatmentType.findMany({
      where: { clinicId },
      orderBy: { name: "asc" },
    }),
  );
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <TratamientosClient initialTratamientos={tratamientos} />
    </div>
  );
}