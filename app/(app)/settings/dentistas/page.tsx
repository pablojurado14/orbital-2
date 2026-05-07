import { withClinic } from "@/lib/tenant-prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import DentistasClient from "./DentistasClient";

export default async function DentistasPage() {
  const clinicId = await getCurrentClinicId();
  const dentistas = await withClinic(clinicId, (tx) =>
    tx.dentist.findMany({
      where: { clinicId },
      orderBy: { name: "asc" },
    }),
  );
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <DentistasClient initialDentistas={dentistas} />
    </div>
  );
}