import { prisma } from "@/lib/prisma";
import CitasClient from "./CitasClient";

export const dynamic = "force-dynamic";

export default async function CitasPage() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [appointmentsRaw, gabinetes, patients, dentists, treatments] = await Promise.all([
    prisma.appointment.findMany({
      where: { date: { gte: today, lt: tomorrow } },
      include: {
        gabinete: true,
        patient: true,
        dentist: true,
        treatmentType: true,
      },
      orderBy: [{ gabineteId: "asc" }, { startTime: "asc" }],
    }),
    prisma.gabinete.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.patient.findMany({ orderBy: { name: "asc" } }),
    prisma.dentist.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.treatmentType.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  const appointments = appointmentsRaw.map((a) => ({
    id: a.id,
    start: a.startTime,
    gabinete: a.gabinete.name,
    patient: a.patient.name,
    type: a.treatmentType?.name ?? "Sin tipo",
    durationSlots: Math.max(1, Math.round(a.duration / 30)),
    status: a.status as "confirmed" | "delayed" | "cancelled" | "suggested",
    value: a.value ?? a.treatmentType?.price ?? 0,
  }));

  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Agenda — Hoy</h1>
        <p className="text-slate-600">
          Click en un slot vacío para crear cita. Click en una cita para mover o cancelar.
        </p>
      </header>

      <CitasClient
        appointments={appointments}
        gabinetes={gabinetes.map((g) => ({ id: g.id, name: g.name }))}
        patients={patients.map((p) => ({ id: p.id, name: p.name }))}
        dentists={dentists.map((d) => ({ id: d.id, name: d.name }))}
        treatments={treatments.map((t) => ({
          id: t.id,
          name: t.name,
          duration: t.duration,
          price: t.price,
        }))}
        date={dateStr}
      />
    </div>
  );
}