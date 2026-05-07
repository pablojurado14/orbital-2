import { NextRequest, NextResponse } from "next/server";
import { withClinic } from "@/lib/tenant-prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import { revalidatePath } from "next/cache";
import { HOURS } from "@/data/mock";

function hhmmToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function fitsInSchedule(
  startMin: number,
  durationMin: number,
  schedule: {
    isOpen: boolean;
    morningOpen: string | null;
    morningClose: string | null;
    afternoonOpen: string | null;
    afternoonClose: string | null;
  }
): boolean {
  if (!schedule.isOpen) return false;
  const endMin = startMin + durationMin;
  const windows: Array<[number, number]> = [];
  if (schedule.morningOpen && schedule.morningClose) {
    const o = hhmmToMinutes(schedule.morningOpen);
    const c = hhmmToMinutes(schedule.morningClose);
    if (o !== null && c !== null) windows.push([o, c]);
  }
  if (schedule.afternoonOpen && schedule.afternoonClose) {
    const o = hhmmToMinutes(schedule.afternoonOpen);
    const c = hhmmToMinutes(schedule.afternoonClose);
    if (o !== null && c !== null) windows.push([o, c]);
  }
  return windows.some(([open, close]) => startMin >= open && endMin <= close);
}

function parseDate(yyyymmdd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyymmdd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const clinicId = await getCurrentClinicId();
    const { id: idStr } = await context.params;
    const id = Number(idStr);
    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ error: "ID de cita invalido" }, { status: 400 });
    }

    const body = await request.json();

    const result = await withClinic(clinicId, async (tx) => {
      const existing = await tx.appointment.findFirst({ where: { id, clinicId } });
      if (!existing) return { error: "Cita no encontrada", status: 404 } as const;
      if (existing.status === "cancelled") {
        return { error: "No se puede mover una cita cancelada", status: 400 } as const;
      }

      const newStartTime =
        typeof body?.startTime === "string" ? body.startTime : existing.startTime;
      const newDuration =
        typeof body?.duration === "number" && body.duration > 0 ? body.duration : existing.duration;
      const newGabineteId =
        Number.isFinite(Number(body?.gabineteId)) && Number(body.gabineteId) > 0
          ? Number(body.gabineteId)
          : existing.gabineteId;
      const newDentistId =
        Number.isFinite(Number(body?.dentistId)) && Number(body.dentistId) > 0
          ? Number(body.dentistId)
          : existing.dentistId;
      const newTreatmentTypeId =
        Number.isFinite(Number(body?.treatmentTypeId)) && Number(body.treatmentTypeId) > 0
          ? Number(body.treatmentTypeId)
          : existing.treatmentTypeId;
      const newDate =
        typeof body?.date === "string" && body.date ? parseDate(body.date) : existing.date;

      if (!newDate) return { error: "Fecha invalida (esperado YYYY-MM-DD)", status: 400 } as const;
      if (!HOURS.includes(newStartTime)) {
        return {
          error: `Hora de inicio invalida (debe ser una franja entre ${HOURS[0]} y ${HOURS[HOURS.length - 1]})`,
          status: 400,
        } as const;
      }

      const [gabinete, dentist, treatment, schedule] = await Promise.all([
        tx.gabinete.findFirst({ where: { id: newGabineteId, clinicId } }),
        tx.dentist.findFirst({ where: { id: newDentistId, clinicId } }),
        tx.treatmentType.findFirst({ where: { id: newTreatmentTypeId, clinicId } }),
        tx.daySchedule.findUnique({
          where: { clinicId_dayOfWeek: { clinicId, dayOfWeek: newDate.getDay() } },
        }),
      ]);
      if (!gabinete || !gabinete.active)
        return { error: "Gabinete no encontrado o inactivo", status: 400 } as const;
      if (!dentist || !dentist.active)
        return { error: "Dentista no encontrado o inactivo", status: 400 } as const;
      if (!treatment || !treatment.active)
        return { error: "Tratamiento no encontrado o inactivo", status: 400 } as const;
      if (!schedule)
        return { error: "No hay horario definido para ese dia de la semana", status: 400 } as const;

      const startMin = hhmmToMinutes(newStartTime);
      if (startMin === null) return { error: "Hora de inicio invalida", status: 400 } as const;
      if (!fitsInSchedule(startMin, newDuration, schedule)) {
        return {
          error: "La cita no cabe en el horario de la clinica para ese dia",
          status: 400,
        } as const;
      }

      const conflicts = await tx.appointment.findMany({
        where: {
          clinicId,
          gabineteId: newGabineteId,
          date: newDate,
          status: { not: "cancelled" },
          NOT: { id },
        },
        select: { id: true, startTime: true, duration: true },
      });

      const newEnd = startMin + newDuration;
      const conflict = conflicts.find((a) => {
        const aStart = hhmmToMinutes(a.startTime);
        if (aStart === null) return false;
        const aEnd = aStart + a.duration;
        return startMin < aEnd && aStart < newEnd;
      });
      if (conflict) {
        return { error: "Ya hay otra cita en ese gabinete a esa hora", status: 409 } as const;
      }

      const updated = await tx.appointment.update({
        where: { id },
        data: {
          date: newDate,
          startTime: newStartTime,
          duration: newDuration,
          gabineteId: newGabineteId,
          dentistId: newDentistId,
          treatmentTypeId: newTreatmentTypeId,
        },
      });

      return { ok: true, id: updated.id } as const;
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    revalidatePath("/");
    revalidatePath("/citas");
    return NextResponse.json({ ok: true, id: result.id });
  } catch (error) {
    console.error("Error moviendo cita:", error);
    return NextResponse.json({ error: "No se pudo mover la cita" }, { status: 500 });
  }
}