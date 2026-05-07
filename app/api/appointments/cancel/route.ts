import { NextRequest, NextResponse } from "next/server";
import { withClinic } from "@/lib/tenant-prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import { revalidatePath } from "next/cache";

export async function POST(request: NextRequest) {
  try {
    const clinicId = await getCurrentClinicId();
    const body = await request.json();
    const appointmentId = Number(body?.appointmentId);

    if (!appointmentId || Number.isNaN(appointmentId)) {
      return NextResponse.json({ error: "appointmentId invalido" }, { status: 400 });
    }

    const result = await withClinic(clinicId, async (tx) => {
      const existingAppointment = await tx.appointment.findFirst({
        where: { id: appointmentId, clinicId },
      });

      if (!existingAppointment) {
        return { error: "Cita no encontrada", status: 404 } as const;
      }
      if (existingAppointment.status === "cancelled") {
        return { error: "La cita ya esta cancelada", status: 400 } as const;
      }

      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: "cancelled" },
      });

      return { ok: true } as const;
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    revalidatePath("/");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error cancelando cita:", error);
    return NextResponse.json({ error: "No se pudo cancelar la cita" }, { status: 500 });
  }
}