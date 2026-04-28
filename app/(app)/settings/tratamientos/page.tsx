import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import TratamientosClient from "./TratamientosClient";

export default async function TratamientosPage() {
  const tratamientos = await prisma.treatmentType.findMany({
    where: { clinicId: getCurrentClinicId() },
    orderBy: { name: "asc" },
  });
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <TratamientosClient initialTratamientos={tratamientos} />
    </div>
  );
}