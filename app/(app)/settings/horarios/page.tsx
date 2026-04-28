import { prisma } from "@/lib/prisma";
import HorariosClient from "./HorariosClient";

export default async function HorariosPage() {
  const clinic = await prisma.clinicSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: "Mi Clínica Dental" },
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
