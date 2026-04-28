import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import { seed } from "@/lib/seed";
import {
  buildOrbitalState,
  SuggestionDecision,
} from "@/lib/orbital-engine";
import { AppointmentStatus, WaitingPatient, HOURS } from "@/data/mock";
import {
  countTodayAppointments,
  calculateOccupancy,
} from "@/lib/dashboard-metrics";

type AppointmentView = {
  id: number;
  start: string;
  gabinete: string;
  patient: string;
  type: string;
  durationSlots: number;
  status: AppointmentStatus;
  value: number;
};

async function ensureSeeded() {
  const clinicId = getCurrentClinicId();
  const clinic = await prisma.clinicSettings.findUnique({ where: { id: clinicId } });

  if (!clinic) {
    await seed();
  }

  await prisma.runtimeState.upsert({
    where: { id: clinicId },
    update: {},
    create: { id: clinicId, suggestionDecision: "pending", clinicId },
  });
}

// PROD-1-DEUDA2 + TZ-MADRID-VERCEL — calcula los límites del día actual en
// zona Europe/Madrid, independientemente del TZ del runtime (Vercel = UTC).
// Mitigación hasta que INTL-3 cierre operativo en Sesión 18.
function getMadridDayBoundaries(): { today: Date; tomorrow: Date } {
  const now = new Date();

  const dateStringMadrid = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
  }).format(now);

  const offsetParts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Madrid",
    timeZoneName: "longOffset",
  }).formatToParts(now);
  const offsetStr =
    offsetParts.find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") ||
    "+00:00";

  const today = new Date(`${dateStringMadrid}T00:00:00${offsetStr}`);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  return { today, tomorrow };
}

async function loadStateData() {
  const clinicId = getCurrentClinicId();
  const { today, tomorrow } = getMadridDayBoundaries();

  const [appointmentsRaw, waitingPatientsRaw, gabinetesRaw, runtime] =
    await Promise.all([
      prisma.appointment.findMany({
        where: {
          clinicId,
          date: {
            gte: today,
            lt: tomorrow,
          },
        },
        include: {
          gabinete: true,
          patient: true,
          dentist: true,
          treatmentType: true,
        },
        orderBy: [{ gabineteId: "asc" }, { startTime: "asc" }],
      }),
      prisma.patient.findMany({
        where: { clinicId, inWaitingList: true },
        include: { waitingTreatment: true, preferredGabinete: true },
        orderBy: { id: "asc" },
      }),
      prisma.gabinete.findMany({
        where: { clinicId, active: true },
        orderBy: { name: "asc" },
      }),
      prisma.runtimeState.findUnique({ where: { id: clinicId } }),
    ]);

  const appointments: AppointmentView[] = appointmentsRaw.map((a) => ({
    id: a.id,
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

  const totalAvailableSlots = gabinetesRaw.length * Math.floor(HOURS.length / 2);

  return {
    appointments,
    waitingList,
    gabinetes,
    decision,
    totalAvailableSlots,
  };
}

export async function GET() {
  await ensureSeeded();

  const {
    appointments,
    waitingList,
    gabinetes,
    decision,
    totalAvailableSlots,
  } = await loadStateData();

  const state = buildOrbitalState(appointments, waitingList, decision);

  const metrics = {
    appointmentsCount: countTodayAppointments(appointments),
    occupancy: calculateOccupancy(appointments, totalAvailableSlots),
    recoveredGaps: state.recoveredGaps,
    recoveredRevenue: state.recoveredRevenue,
  };

  return NextResponse.json({ ...state, gabinetes, metrics });
}

export async function POST(request: NextRequest) {
  await ensureSeeded();
  const clinicId = getCurrentClinicId();

  const body = await request.json();
  const action = body?.action as SuggestionDecision | "reset";

  if (action === "reset") {
    await prisma.runtimeState.upsert({
      where: { id: clinicId },
      update: { suggestionDecision: "pending" },
      create: { id: clinicId, suggestionDecision: "pending", clinicId },
    });
  } else if (
    action === "accepted" ||
    action === "rejected" ||
    action === "pending"
  ) {
    await prisma.runtimeState.upsert({
      where: { id: clinicId },
      update: { suggestionDecision: action },
      create: { id: clinicId, suggestionDecision: action, clinicId },
    });
  } else {
    return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
  }

  const {
    appointments,
    waitingList,
    gabinetes,
    decision,
    totalAvailableSlots,
  } = await loadStateData();

  const state = buildOrbitalState(appointments, waitingList, decision);

  const metrics = {
    appointmentsCount: countTodayAppointments(appointments),
    occupancy: calculateOccupancy(appointments, totalAvailableSlots),
    recoveredGaps: state.recoveredGaps,
    recoveredRevenue: state.recoveredRevenue,
  };

  return NextResponse.json({ ...state, gabinetes, metrics });
}