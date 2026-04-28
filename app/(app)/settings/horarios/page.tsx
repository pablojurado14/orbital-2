import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import HorariosClient from "./HorariosClient";

export default async function HorariosPage() {
  const clinicId = getCurrentClinicId();

  const clinic = await prisma.clinicSettings.upsert({
    where: { id: clinicId },
    update: {},
    create: { id: clinicId, name: "Mi Clínica Dental" },
  });

  const schedules = await prisma.daySchedule.findMany({
    where: { clinicId: clinic.id },
    orderBy: { dayOfWeek: "asc" },
  });

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <HorariosClient initialSchedules={schedules} clinicName={clinic.name} />
    </div>
  );
}