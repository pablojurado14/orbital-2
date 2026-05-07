import { withClinic } from "@/lib/tenant-prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import HorariosClient from "./HorariosClient";

export default async function HorariosPage() {
  const clinicId = await getCurrentClinicId();

  const { clinic, schedules } = await withClinic(clinicId, async (tx) => {
    const clinic = await tx.clinicSettings.upsert({
      where: { id: clinicId },
      update: {},
      create: { id: clinicId, name: "Mi Clinica Dental" },
    });

    const schedules = await tx.daySchedule.findMany({
      where: { clinicId: clinic.id },
      orderBy: { dayOfWeek: "asc" },
    });

    return { clinic, schedules };
  });

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <HorariosClient initialSchedules={schedules} clinicName={clinic.name} />
    </div>
  );
}