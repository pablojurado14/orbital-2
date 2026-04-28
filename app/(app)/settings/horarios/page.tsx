import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import HorariosClient from "./HorariosClient";

export const dynamic = "force-dynamic";

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

  return <HorariosClient initialSchedules={schedules} clinicName={clinic.name} />;
}