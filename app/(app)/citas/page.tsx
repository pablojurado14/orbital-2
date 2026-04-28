import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import CitasClient from "./CitasClient";

export const dynamic = "force-dynamic";

function todayMadridYYYYMMDD(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
}

type AppointmentStatus = "confirmed" | "delayed" | "cancelled" | "suggested";

export default async function CitasPage() {
  const clinicId = getCurrentClinicId();
  const dateStr = todayMadridYYYYMMDD();

  const [appointmentsRaw, gabinetes, patients, dentists, treatments] = await Promise.all([
    prisma.appointment.findMany({
      where: { clinicId },
      include: {
        gabinete: true,
        patient: true,
        treatmentType: true,
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    }),
    prisma.gabinete.findMany({ where: { clinicId, active: true }, orderBy: { name: "asc" } }),
    prisma.patient.findMany({ where: { clinicId }, orderBy: { name: "asc" } }),
    prisma.dentist.findMany({ where: { clinicId, active: true }, orderBy: { name: "asc" } }),
    prisma.treatmentType.findMany({ where: { clinicId, active: true }, orderBy: { name: "asc" } }),
  ]);

  const appointments = appointmentsRaw.map((a) => ({
    id: a.id,
    start: a.startTime,
    gabinete: a.gabinete.name,
    patient: a.patient.name,
    type: a.treatmentType?.name ?? "Sin tipo",
    durationSlots: Math.max(1, Math.round(a.duration / 30)),
    status: a.status as AppointmentStatus,
    value: a.value ?? a.treatmentType?.price ?? 0,
  }));

  return (
    <CitasClient
      appointments={appointments}
      gabinetes={gabinetes}
      patients={patients}
      dentists={dentists}
      treatments={treatments}
      date={dateStr}
    />
  );
}