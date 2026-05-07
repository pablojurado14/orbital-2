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

export async function POST(request: NextRequest) {
  try {
    const clinicId = await getCurrentClinicId();
    const body = await request.json();

    const patientId = Number(body?.patientId);
    const dentistId = Number(body?.dentistId);
    const gabineteId = Number(body?.gabineteId);
    const treatmentTypeId = Number(body?.treatmentTypeId);
    const duration = Number(body?.duration);
    const startTime = String(body?.startTime ?? "");
    const dateStr = String(body?.date ?? "");
    const valueRaw = body?.value;

    if (!patientId || !dentistId || !gabineteId || !treatmentTypeId) {
      return NextResponse.json(
        { error: "Faltan datos: paciente, dentista, gabinete y tratamiento son obligatorios" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      return NextResponse.json({ error: "Duracion invalida" }, { status: 400 });
    }
    if (!HOURS.includes(startTime)) {
      return NextResponse.json(
        { error: `Hora de inicio invalida (debe ser una franja entre ${HOURS[0]} y ${HOURS[HOURS.length - 1]})` },
        { status: 400 }
      );
    }
    const date = parseDate(dateStr);
    if (!date) {
      return NextResponse.json({ error: "Fecha invalida (esperado YYYY-MM-DD)" }, { status: 400 });
    }
    const startMin = hhmmToMinutes(startTime);
    if (startMin === null) {
      return NextResponse.json({ error: "Hora de inicio invalida" }, { status: 400 });
    }

    const result = await withClinic(clinicId, async (tx) => {
      const [patient, dentist, gabinete, treatment, schedule] = await Promise.all([
        tx.patient.findFirst({ where: { id: patientId, clinicId } }),
        tx.dentist.findFirst({ where: { id: dentistId, clinicId } }),
        tx.gabinete.findFirst({ where: { id: gabineteId, clinicId } }),
        tx.treatmentType.findFirst({ where: { id: treatmentTypeId, clinicId } }),
        tx.daySchedule.findUnique({
          where: { clinicId_dayOfWeek: { clinicId, dayOfWeek: date.getDay() } },
        }),
      ]);

      if (!patient) return { error: "Paciente no encontrado", status: 400 } as const;
      if (!dentist || !dentist.active) return { error: "Dentista no encontrado o inactivo", status: 400 } as const;
      if (!gabinete || !gabinete.active) return { error: "Gabinete no encontrado o inactivo", status: 400 } as const;
      if (!treatment || !treatment.active) return { error: "Tratamiento no encontrado o inactivo", status: 400 } as const;
      if (!schedule) return { error: "No hay horario definido para ese dia de la semana", status: 400 } as const;
      if (!fitsInSchedule(startMin, duration, schedule)) {
        return { error: "La cita no cabe en el horario de la clinica para ese dia", status: 400 } as const;
      }

      const sameDayInGabinete = await tx.appointment.findMany({
        where: { clinicId, gabineteId, date, status: { not: "cancelled" } },
        select: { id: true, startTime: true, duration: true },
      });

      const newEnd = startMin + duration;
      const conflict = sameDayInGabinete.find((a) => {
        const aStart = hhmmToMinutes(a.startTime);
        if (aStart === null) return false;
        const aEnd = aStart + a.duration;
        return startMin < aEnd && aStart < newEnd;
      });
      if (conflict) {
        return { error: "Ya hay una cita en ese gabinete a esa hora", status: 409 } as const;
      }

      const value =
        typeof valueRaw === "number" && Number.isFinite(valueRaw)
          ? valueRaw
          : treatment.price ?? 0;

      const created = await tx.appointment.create({
        data: {
          clinicId, date, startTime, duration,
          status: "confirmed", value,
          patientId, dentistId, gabineteId, treatmentTypeId,
        },
      });

      return { ok: true, id: created.id } as const;
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    revalidatePath("/");
    revalidatePath("/citas");

    return NextResponse.json({ ok: true, id: result.id });
  } catch (error) {
    console.error("Error creando cita:", error);
    return NextResponse.json({ error: "No se pudo crear la cita" }, { status: 500 });
  }
}