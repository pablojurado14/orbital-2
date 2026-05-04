import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import { seed } from "@/lib/seed";
import type { SuggestionDecision } from "@/lib/types/orbital-state";
import { AppointmentStatus, WaitingPatient, HOURS } from "@/data/mock";
import {
  countTodayAppointments,
  calculateOccupancy,
} from "@/lib/dashboard-metrics";
import { processEventForLegacyApi } from "@/lib/core/adapter";
import type { EngineEvent } from "@/lib/core/types";

// =============================================================================
// Sesión 18.5 — Flag flippeado: el motor v2.0 (clean core) sirve respuestas
// Sesión 18.6 — Iteración de candidatas vía RejectedCandidate
// =============================================================================

/**
 * Flag de migración del motor v7.3 al motor v2.0 (clean core).
 *
 * Estado actual (Sesión 18.5+): USE_CLEAN_CORE = true. El motor v2.0 sirve
 * la respuesta visible al usuario en cada GET y POST.
 *
 * Rollback: git revert + redeploy. En Sesión 19.5 (auth real) el flag pasa
 * a env var (process.env.USE_CLEAN_CORE) para rollback sin redeploy.
 */
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

/**
 * Housekeeping S18.6: purga RejectedCandidate de días anteriores al actual
 * (medianoche Madrid). Idempotente, barato — la tabla tiene índice por
 * (clinicId, rejectedAt). Se ejecuta en cada llamada de ensureSeeded, lo
 * que en la práctica es cada GET/POST inicial pero no añade carga
 * significativa porque las filas afectadas son pocas (<10 por día por
 * clínica en uso típico).
 *
 * Decisión rectora 11 (S18.6): los rejected son válidos solo dentro del
 * día operativo. Al cambiar de día, los huecos del día anterior dejan de
 * existir como conceptos relevantes (el seed de mañana traerá appointments
 * nuevos con IDs nuevos), por lo que las rejected del día previo dejan de
 * tener semántica.
 *
 * Deuda blanda registrada: REJECTED-CANDIDATE-HOUSEKEEPING-NOT-IN-ADAPTER-V1
 * — el housekeeping vive en route.ts. Si el adapter se invoca fuera del
 * flujo de route.ts (smoke test, cron job futuro), puede leer rejected
 * obsoletos. Mover a job programado o pieza compartida en S20+.
 */
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

  // S18.6: purgar rejected de días anteriores.
  await purgeStaleRejectedCandidates(clinicId);
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
 * blanda: EVENT-SYNTHESIS-FROM-DB-V1.
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

/**
 * POST acepta múltiples acciones:
 *
 *   - { action: "accepted" | "rejected" | "pending" } → actualiza
 *     RuntimeState.suggestionDecision. Comportamiento heredado del v7.3.
 *
 *   - { action: "reset" } → resetea suggestionDecision a "pending" Y purga
 *     todas las RejectedCandidate del clinic (S18.6: el reset también borra
 *     el historial de candidatas rechazadas, para que el motor pueda
 *     reproponer desde cero).
 *
 *   - { action: "reject_candidate", gapEventId, waitingCandidateId } →
 *     persiste el rechazo de UNA candidata específica para UN hueco
 *     concreto. NO toca suggestionDecision (queda "pending" para que el
 *     siguiente GET dispare el motor con el waitlist filtrado y proponga
 *     la siguiente candidata top-1). Idempotente: si la candidata ya está
 *     rechazada para ese gap, devuelve OK sin error.
 *
 *     Cuando se rechazan TODAS las candidatas viables del waitlist, el
 *     motor producirá proposal=null en el siguiente GET → la UI mostrará
 *     "Caso cerrado: ningún candidato aceptado".
 */
export async function POST(request: NextRequest) {
  await ensureSeeded();
  const clinicId = getCurrentClinicId();

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
    // S18.6: reset también limpia historial de rejected.
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
    // Persiste el rechazo. Idempotente vía @@unique del schema:
    // si ya existe, capturamos el error de unique violation y devolvemos OK.
    try {
      await prisma.rejectedCandidate.create({
        data: { clinicId, gapEventId, waitingCandidateId },
      });
    } catch (e: unknown) {
      // P2002 = unique constraint violation en Prisma. Aceptable: la
      // candidata ya estaba rechazada, idempotente.
      const code = (e as { code?: string }).code;
      if (code !== "P2002") {
        throw e;
      }
    }
    // NO tocamos suggestionDecision — sigue en "pending" para que el motor
    // proponga la siguiente candidata en el GET subsecuente.
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