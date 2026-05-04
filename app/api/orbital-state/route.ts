import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import { seed } from "@/lib/seed";
import type { SuggestionDecision } from "@/lib/types/orbital-state";
import { AppointmentStatus, HOURS } from "@/data/mock";
import {
  countTodayAppointments,
  calculateOccupancy,
} from "@/lib/dashboard-metrics";
import { processEventForLegacyApi } from "@/lib/core/adapter";
import type { EngineEvent } from "@/lib/core/types";

// =============================================================================
// Sesión 18.5 — Flag flippeado: el motor v2.0 (clean core) sirve respuestas
// Sesión 18.6 — Iteración de candidatas vía RejectedCandidate
// Sesión 19.B — Limpiado bloque muerto waitingPatientsRaw/waitingList:
//                 el clean core ya lee WaitlistEntry vía adapter.
// =============================================================================

const USE_CLEAN_CORE = true;
const SHADOW_MODE = false;

if (!USE_CLEAN_CORE) {
  throw new Error(
    "Sesión 18.5: USE_CLEAN_CORE debe estar a true. La rama legacy se eliminó " +
      "del archivo. Si necesitas rollback, usa git revert.",
  );
}
void SHADOW_MODE;

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

async function purgeStaleRejectedCandidates(clinicId: number): Promise<void> {
  const { today } = getMadridDayBoundaries();
  await prisma.rejectedCandidate.deleteMany({
    where: {
      clinicId,
      rejectedAt: { lt: today },
    },
  });
}

async function ensureSeeded() {
  const clinicId = await getCurrentClinicId();
  const clinic = await prisma.clinicSettings.findUnique({ where: { id: clinicId } });

  if (!clinic) {
    await seed();
  }

  await prisma.runtimeState.upsert({
    where: { id: clinicId },
    update: {},
    create: { id: clinicId, suggestionDecision: "pending", clinicId },
  });

  await purgeStaleRejectedCandidates(clinicId);
}

async function loadStateData() {
  const clinicId = await getCurrentClinicId();
  const { today, tomorrow } = getMadridDayBoundaries();

  const [appointmentsRaw, gabinetesRaw, runtime] = await Promise.all([
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
    prisma.gabinete.findMany({
      where: { clinicId, active: true },
      orderBy: { name: "asc" },
    }),
    prisma.runtimeState.findUnique({ where: { id: clinicId } }),
  ]);

  const appointmentsView: AppointmentView[] = appointmentsRaw.map((a) => ({
    id: a.id,
    start: a.startTime,
    gabinete: a.gabinete.name,
    patient: a.patient.name,
    type: a.treatmentType?.name ?? "Sin tipo",
    durationSlots: Math.max(1, Math.round(a.duration / 30)),
    status: a.status as AppointmentStatus,
    value: a.value ?? a.treatmentType?.price ?? 0,
  }));

  const gabinetes = gabinetesRaw.map((g) => g.name);
  const decision = (runtime?.suggestionDecision ?? "pending") as SuggestionDecision;

  const totalAvailableSlots = gabinetesRaw.length * Math.floor(HOURS.length / 2);

  return {
    appointmentsRaw,
    appointmentsView,
    gabinetes,
    decision,
    totalAvailableSlots,
  };
}

function synthesizeEventFromState(
  appointmentsRaw: ReadonlyArray<{ id: number; status: string }>,
  clinicId: number,
): EngineEvent {
  const tenantId = String(clinicId);
  const cancelled = appointmentsRaw.find((a) => a.status === "cancelled");
  if (cancelled !== undefined) {
    return {
      kind: "cancellation",
      instant: Date.now(),
      tenantId,
      eventId: String(cancelled.id),
      noticeAheadMs: 0,
    };
  }
  return {
    kind: "proactive_tick",
    instant: Date.now(),
    tenantId,
  };
}

async function buildResponseFromCleanCore(
  clinicId: number,
  appointmentsRaw: ReadonlyArray<{ id: number; status: string }>,
  appointmentsView: AppointmentView[],
  decision: SuggestionDecision,
) {
  const event = synthesizeEventFromState(appointmentsRaw, clinicId);
  const legacyAppointments = appointmentsView.map((a) => ({
    start: a.start,
    gabinete: a.gabinete,
    patient: a.patient,
    type: a.type,
    durationSlots: a.durationSlots,
    status: a.status,
    value: a.value,
  }));
  return processEventForLegacyApi(event, decision, legacyAppointments);
}

export async function GET() {
  await ensureSeeded();
  const clinicId = await getCurrentClinicId();

  const {
    appointmentsRaw,
    appointmentsView,
    gabinetes,
    decision,
    totalAvailableSlots,
  } = await loadStateData();

  const state = await buildResponseFromCleanCore(
    clinicId,
    appointmentsRaw,
    appointmentsView,
    decision,
  );

  const metrics = {
    appointmentsCount: countTodayAppointments(appointmentsView),
    occupancy: calculateOccupancy(appointmentsView, totalAvailableSlots),
    recoveredGaps: state.recoveredGaps,
    recoveredRevenue: state.recoveredRevenue,
  };

  return NextResponse.json({ ...state, gabinetes, metrics });
}

export async function POST(request: NextRequest) {
  await ensureSeeded();
  const clinicId = await getCurrentClinicId();

  const body = await request.json();
  const action = body?.action as
    | SuggestionDecision
    | "reset"
    | "reject_candidate";

  if (action === "reset") {
    await prisma.runtimeState.upsert({
      where: { id: clinicId },
      update: { suggestionDecision: "pending" },
      create: { id: clinicId, suggestionDecision: "pending", clinicId },
    });
    await prisma.rejectedCandidate.deleteMany({ where: { clinicId } });
  } else if (action === "reject_candidate") {
    const gapEventId = body?.gapEventId;
    const waitingCandidateId = body?.waitingCandidateId;
    if (
      typeof gapEventId !== "string" ||
      typeof waitingCandidateId !== "string"
    ) {
      return NextResponse.json(
        {
          error:
            "reject_candidate requiere gapEventId y waitingCandidateId como string",
        },
        { status: 400 },
      );
    }
    try {
      await prisma.rejectedCandidate.create({
        data: { clinicId, gapEventId, waitingCandidateId },
      });
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code !== "P2002") {
        throw e;
      }
    }
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
    appointmentsRaw,
    appointmentsView,
    gabinetes,
    decision,
    totalAvailableSlots,
  } = await loadStateData();

  const state = await buildResponseFromCleanCore(
    clinicId,
    appointmentsRaw,
    appointmentsView,
    decision,
  );

  const metrics = {
    appointmentsCount: countTodayAppointments(appointmentsView),
    occupancy: calculateOccupancy(appointmentsView, totalAvailableSlots),
    recoveredGaps: state.recoveredGaps,
    recoveredRevenue: state.recoveredRevenue,
  };

  return NextResponse.json({ ...state, gabinetes, metrics });
}