import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import { withClinic, type TenantTx } from "@/lib/tenant-prisma";
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
// Sesión 19.6 — RLS Postgres + wrapper withClinic. Toda la lógica del request
//                 se ejecuta dentro de una transacción con SET LOCAL aplicado
//                 por withClinic, lo cual activa RLS en runtime contra roles
//                 no-owner. Bootstrap (ensureClinicExists) queda fuera porque
//                 seed() todavía usa prisma global (deuda
//                 SEED-NOT-USING-WITHCLINIC-V1, S19.7+).
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
 
// =============================================================================
// Bootstrap (FUERA de withClinic).
// seed() usa prisma global y crea ClinicSettings, que no tiene RLS.
// Refactor de seed para tomar tx queda como deuda S19.7+.
// =============================================================================
 
async function ensureClinicExists(clinicId: number): Promise<void> {
  const clinic = await prisma.clinicSettings.findUnique({
    where: { id: clinicId },
  });
  if (!clinic) {
    await seed();
  }
}
 
// =============================================================================
// Helpers que viven DENTRO de withClinic (reciben tx + clinicId).
// Las queries pasan por tx para que SET LOCAL aplicado por withClinic
// active RLS Postgres contra roles no-owner.
// =============================================================================
 
async function purgeStaleRejectedCandidates(
  tx: TenantTx,
  clinicId: number,
): Promise<void> {
  const { today } = getMadridDayBoundaries();
  await tx.rejectedCandidate.deleteMany({
    where: {
      clinicId,
      rejectedAt: { lt: today },
    },
  });
}
 
async function ensureRuntimeStatePending(
  tx: TenantTx,
  clinicId: number,
): Promise<void> {
  await tx.runtimeState.upsert({
    where: { id: clinicId },
    update: {},
    create: { id: clinicId, suggestionDecision: "pending", clinicId },
  });
}
 
async function loadStateData(tx: TenantTx, clinicId: number) {
  const { today, tomorrow } = getMadridDayBoundaries();
 
  const [appointmentsRaw, gabinetesRaw, runtime] = await Promise.all([
    tx.appointment.findMany({
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
    tx.gabinete.findMany({
      where: { clinicId, active: true },
      orderBy: { name: "asc" },
    }),
    tx.runtimeState.findUnique({ where: { id: clinicId } }),
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
  tx: TenantTx,
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
  return processEventForLegacyApi(
    tx,
    clinicId,
    event,
    decision,
    legacyAppointments,
  );
}
 
// =============================================================================
// GET handler
// =============================================================================
 
export async function GET() {
  const clinicId = await getCurrentClinicId();
  await ensureClinicExists(clinicId);
 
  const response = await withClinic(clinicId, async (tx) => {
    await ensureRuntimeStatePending(tx, clinicId);
    await purgeStaleRejectedCandidates(tx, clinicId);
 
    const {
      appointmentsRaw,
      appointmentsView,
      gabinetes,
      decision,
      totalAvailableSlots,
    } = await loadStateData(tx, clinicId);
 
    const state = await buildResponseFromCleanCore(
      tx,
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
 
    return { ...state, gabinetes, metrics };
  });
 
  return NextResponse.json(response);
}
 
// =============================================================================
// POST handler
// =============================================================================
 
export async function POST(request: NextRequest) {
  const clinicId = await getCurrentClinicId();
  await ensureClinicExists(clinicId);
 
  const body = await request.json();
  const action = body?.action as
    | SuggestionDecision
    | "reset"
    | "reject_candidate";
 
  // Pre-validación de action ANTES de abrir transacción.
  if (
    action !== "reset" &&
    action !== "reject_candidate" &&
    action !== "accepted" &&
    action !== "rejected" &&
    action !== "pending"
  ) {
    return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
  }
 
  // Pre-validación de payload para reject_candidate.
  let rejectGapEventId: string | undefined;
  let rejectWaitingCandidateId: string | undefined;
  if (action === "reject_candidate") {
    rejectGapEventId = body?.gapEventId;
    rejectWaitingCandidateId = body?.waitingCandidateId;
    if (
      typeof rejectGapEventId !== "string" ||
      typeof rejectWaitingCandidateId !== "string"
    ) {
      return NextResponse.json(
        {
          error:
            "reject_candidate requiere gapEventId y waitingCandidateId como string",
        },
        { status: 400 },
      );
    }
  }
 
  const response = await withClinic(clinicId, async (tx) => {
    await ensureRuntimeStatePending(tx, clinicId);
    await purgeStaleRejectedCandidates(tx, clinicId);
 
    if (action === "reset") {
      await tx.runtimeState.upsert({
        where: { id: clinicId },
        update: { suggestionDecision: "pending" },
        create: { id: clinicId, suggestionDecision: "pending", clinicId },
      });
      await tx.rejectedCandidate.deleteMany({ where: { clinicId } });
    } else if (action === "reject_candidate") {
      try {
        await tx.rejectedCandidate.create({
          data: {
            clinicId,
            gapEventId: rejectGapEventId!,
            waitingCandidateId: rejectWaitingCandidateId!,
          },
        });
      } catch (e: unknown) {
        const code = (e as { code?: string }).code;
        if (code !== "P2002") {
          throw e;
        }
      }
    } else {
      // accepted / rejected / pending
      await tx.runtimeState.upsert({
        where: { id: clinicId },
        update: { suggestionDecision: action },
        create: { id: clinicId, suggestionDecision: action, clinicId },
      });
    }
 
    const {
      appointmentsRaw,
      appointmentsView,
      gabinetes,
      decision,
      totalAvailableSlots,
    } = await loadStateData(tx, clinicId);
 
    const state = await buildResponseFromCleanCore(
      tx,
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
 
    return { ...state, gabinetes, metrics };
  });
 
  return NextResponse.json(response);
}