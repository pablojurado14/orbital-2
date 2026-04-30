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
import { processEvent as cleanCoreProcessEvent } from "@/lib/core/adapter";
import type { EngineEvent } from "@/lib/core/types";

// =============================================================================
// Sesión 18 — Flag y shadow mode
// =============================================================================

/**
 * Flag de migración del motor v7.3 al motor v2.0 (clean core).
 *
 * - USE_CLEAN_CORE=false (default): la API sirve la respuesta del motor v7.3
 *   legacy intacta. El motor v2.0 NO se ejecuta. Comportamiento previo a
 *   Sesión 18, sin cambios visibles.
 *
 * - USE_CLEAN_CORE=false + SHADOW_MODE=true: la API sigue sirviendo v7.3,
 *   pero ADEMÁS ejecuta el motor v2.0 en paralelo (después de devolver la
 *   respuesta) y lo loguea. El usuario no nota nada. Sirve para detectar
 *   excepciones del adapter contra datos reales antes de flippear.
 *
 * - USE_CLEAN_CORE=true (Sesión 18.5+): la API sirve la respuesta del clean
 *   core traducida a la forma legacy OrbitalState. v7.3 deja de ejecutarse.
 *   En Sesión 19 se borra lib/orbital-engine.ts.
 *
 * Estos flags son constantes hoy. En Sesión 18.5 se promoverán a env vars
 * (process.env.USE_CLEAN_CORE) para permitir rollback sin redeploy.
 */
const USE_CLEAN_CORE = false;
const SHADOW_MODE = true;

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
// Mitigación hasta que INTL-3 cierre operativo en Sesión 18.5+.
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

/**
 * Ejecuta el motor v2.0 (clean core) en shadow mode: lo invoca y loguea el
 * resultado, pero NO afecta a la respuesta servida al usuario. Si lanza
 * excepción, se captura y se loguea sin propagarse.
 *
 * Disparamos un proactive_tick como evento "neutro" — equivale a la pregunta
 * "¿qué propone el motor sobre el estado actual sin un evento concreto?".
 * Cuando flippeemos USE_CLEAN_CORE=true en Sesión 18.5, el evento real
 * dependerá de la operación (GET = proactive_tick, POST = manual_signal con
 * la decisión del usuario).
 */
async function runShadowModeCleanCore(): Promise<void> {
  try {
    const tenantId = String(getCurrentClinicId());
    const event: EngineEvent = {
      kind: "proactive_tick",
      instant: Date.now(),
      tenantId,
    };
    const decision = await cleanCoreProcessEvent(event);

    console.log("[SHADOW] clean core ejecutado OK", {
      hasProposal: decision.proposal !== null,
      proposalKind: decision.proposal?.[0]?.kind ?? null,
      motiveCode: decision.explanation.motiveCode,
      alternativesCount: decision.explanation.consideredAlternatives.length,
      autonomyLevel: decision.autonomyLevel,
    });
  } catch (e) {
    console.error("[SHADOW] clean core lanzó excepción:", e);
  }
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

  const response = NextResponse.json({ ...state, gabinetes, metrics });

  // Shadow mode: ejecutar clean core en paralelo (fire-and-forget).
  // No afecta a la respuesta. No bloquea. Solo loguea para validación.
  if (!USE_CLEAN_CORE && SHADOW_MODE) {
    runShadowModeCleanCore().catch(() => {
      // Defensivo: runShadowModeCleanCore ya captura sus propios errores,
      // pero si algo se nos escapa, swallow it. Shadow nunca debe fallar la request.
    });
  }

  return response;
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

  const response = NextResponse.json({ ...state, gabinetes, metrics });

  if (!USE_CLEAN_CORE && SHADOW_MODE) {
    runShadowModeCleanCore().catch(() => {});
  }

  return response;
}