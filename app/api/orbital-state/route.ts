import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import { seed } from "@/lib/seed";
import type { SuggestionDecision } from "@/lib/orbital-engine";
import { AppointmentStatus, WaitingPatient, HOURS } from "@/data/mock";
import {
  countTodayAppointments,
  calculateOccupancy,
} from "@/lib/dashboard-metrics";
import { processEventForLegacyApi } from "@/lib/core/adapter";
import type { EngineEvent } from "@/lib/core/types";

// =============================================================================
// Sesión 18.5 — Flag flippeado: el motor v2.0 (clean core) sirve respuestas
// =============================================================================

/**
 * Flag de migración del motor v7.3 al motor v2.0 (clean core).
 *
 * Estado actual (Sesión 18.5): USE_CLEAN_CORE = true.
 *
 * El motor v2.0 sirve la respuesta visible al usuario en cada GET y POST.
 * processEventForLegacyApi traduce el CycleDecision producido por el clean
 * core a la forma legacy OrbitalState que la UI espera.
 *
 * El motor v7.3 legacy (lib/orbital-engine.ts) sigue compilando para no
 * romper tests/imports cruzados, pero NO se ejecuta. Se borra en Sesión 19.
 *
 * Rollback: git revert del commit que flippea el flag + redeploy. Coste:
 * <5 min. En Sesión 19.5 (auth real) el flag pasará a env var
 * (process.env.USE_CLEAN_CORE) para rollback sin redeploy.
 */
const USE_CLEAN_CORE = true;
const SHADOW_MODE = false;

// Aserción defensiva: si alguien deja el flag a false, el archivo todavía
// compila pero rompe en runtime — fuerza coherencia con el estado declarado.
if (!USE_CLEAN_CORE) {
  throw new Error(
    "Sesión 18.5: USE_CLEAN_CORE debe estar a true. La rama legacy se eliminó " +
      "del archivo. Si necesitas rollback, usa git revert.",
  );
}
// Lint: SHADOW_MODE se mantiene como referencia documental (estado del flag
// previo a 18.5). Cuando se borre v7.3 en S19, ambos constantes se eliminan.
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
// Mitigación hasta que TZ-MADRID-VERCEL cierre operativo (S18.5/S19).
// Duplicado en lib/core/adapter.ts hasta unificación — deuda
// ADAPTER-TZ-MADRID-DUPLICATED-V1.
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

  // appointmentsRaw se devuelve también, lo necesitamos para sintetizar el
  // cancellation event con su id real (no el view simplificado).
  return {
    appointmentsRaw,
    appointmentsView,
    waitingList,
    gabinetes,
    decision,
    totalAvailableSlots,
  };
}

/**
 * Sintetiza un EngineEvent desde el state del DB.
 *
 * Decisión rectora 11 (S18.5): el flujo legacy de la URL pública no recibe
 * eventos del exterior — solo lee el state del DB en cada GET/POST. Para
 * alimentar el motor v2.0 (event-driven) desde este flujo legacy, el shim
 * de route.ts sintetiza el evento más informativo posible:
 *
 *   - Si hay al menos un appointment con status="cancelled" en el día →
 *     EventoCancelacionPaciente sobre el primer cancelled. Paridad funcional
 *     con v7.3 (que también detecta solo el primer gap — deuda heredada
 *     ENGINE-V7-SINGLE-GAP-DETECTION, se cierra en S19).
 *   - Si no hay cancelled → proactive_tick. En v1 el Generator con
 *     proactive_sweep devuelve [] (deuda PROACTIVE-SWEEP-MULTI-GAP-V1), por
 *     lo que el motor producirá proposal=null. Equivalente a "no hay nada
 *     que sugerir", paridad con v7.3 cuando no hay cancelled.
 *
 * Cuando exista bus de eventos real (post Sesión 20), esta síntesis
 * desaparece — los eventos llegarán de verdad. Documentado como deuda
 * blanda nueva: EVENT-SYNTHESIS-FROM-DB-V1.
 */
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

/**
 * Construye la respuesta legacy OrbitalState ejecutando el motor v2.0
 * sobre el state del DB. Sustituye al buildOrbitalState del v7.3.
 *
 * Llamado desde GET y POST tras loadStateData.
 */
async function buildResponseFromCleanCore(
  clinicId: number,
  appointmentsRaw: ReadonlyArray<{ id: number; status: string }>,
  appointmentsView: AppointmentView[],
  decision: SuggestionDecision,
) {
  const event = synthesizeEventFromState(appointmentsRaw, clinicId);
  // Convertimos AppointmentView[] al shape de Appointment que espera
  // processEventForLegacyApi (sin el id, que la UI no usa).
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
  const clinicId = getCurrentClinicId();

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