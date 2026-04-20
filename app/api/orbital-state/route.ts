import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { seedDemoData } from "@/lib/seed";
import {
  buildOrbitalState,
  SuggestionDecision,
} from "@/lib/orbital-engine";
import { Appointment, AppointmentStatus, WaitingPatient } from "@/data/mock";

async function ensureSeeded() {
  const clinic = await prisma.clinicSettings.findUnique({ where: { id: 1 } });
  if (!clinic) {
    await seedDemoData();
  }
  await prisma.runtimeState.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, suggestionDecision: "pending" },
  });
}

async function loadStateData() {
  const [appointmentsRaw, waitingPatientsRaw, gabinetesRaw, runtime] =
    await Promise.all([
      prisma.appointment.findMany({
        include: { gabinete: true, patient: true, dentist: true, treatmentType: true },
        orderBy: [{ gabineteId: "asc" }, { startTime: "asc" }],
      }),
      prisma.patient.findMany({
        where: { inWaitingList: true },
        include: { waitingTreatment: true, preferredGabinete: true },
        orderBy: { id: "asc" },
      }),
      prisma.gabinete.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.runtimeState.findUnique({ where: { id: 1 } }),
    ]);

  const appointments: Appointment[] = appointmentsRaw.map((a) => ({
    start: a.startTime,
    gabinete: a.gabinete.name,
    patient: a.patient.name,
    type: a.treatmentType?.name ?? "Sin tipo",
    durationSlots: Math.max(1, Math.round(a.duration / 30)),
    status: a.status as AppointmentStatus,
    value: a.value ?? a.treatmentType?.price ?? 0,
  }));

  const waitingList: WaitingPatient[] = waitingPatientsRaw.map((p) => {
    const fallbackDurationSlots = p.waitingTreatment?.duration
      ? Math.max(1, Math.round(p.waitingTreatment.duration / 30))
      : 1;
    return {
      name: p.name,
      treatment: p.waitingTreatment?.name ?? "Sin tratamiento",
      durationSlots: p.waitingDurationSlots ?? fallbackDurationSlots,
      value: p.waitingValue ?? p.waitingTreatment?.price ?? 0,
      priority: p.priority,
      availableNow: p.availableNow,
      easeScore: p.easeScore,
      preferredGabinete: p.preferredGabinete?.name,
    };
  });

  const gabinetes = gabinetesRaw.map((g) => g.name);
  const decision = (runtime?.suggestionDecision ?? "pending") as SuggestionDecision;

  return { appointments, waitingList, gabinetes, decision };
}

export async function GET() {
  await ensureSeeded();
  const { appointments, waitingList, gabinetes, decision } = await loadStateData();
  const state = buildOrbitalState(appointments, waitingList, decision);
  return NextResponse.json({ ...state, gabinetes });
}

export async function POST(request: NextRequest) {
  await ensureSeeded();

  const body = await request.json();
  const action = body?.action as SuggestionDecision | "reset";

  if (action === "reset") {
    await prisma.runtimeState.upsert({
      where: { id: 1 },
      update: { suggestionDecision: "pending" },
      create: { id: 1, suggestionDecision: "pending" },
    });
  } else if (action === "accepted" || action === "rejected" || action === "pending") {
    await prisma.runtimeState.upsert({
      where: { id: 1 },
      update: { suggestionDecision: action },
      create: { id: 1, suggestionDecision: action },
    });
  } else {
    return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
  }

  const { appointments, waitingList, gabinetes, decision } = await loadStateData();
  const state = buildOrbitalState(appointments, waitingList, decision);
  return NextResponse.json({ ...state, gabinetes });
}
