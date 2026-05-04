import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import { revalidatePath } from "next/cache";

export async function POST(request: NextRequest) {
  try {
    const clinicId = await getCurrentClinicId();
    const body = await request.json();
    const appointmentId = Number(body?.appointmentId);

    if (!appointmentId || Number.isNaN(appointmentId)) {
      return NextResponse.json(
        { error: "appointmentId inválido" },
        { status: 400 }
      );
    }

    const existingAppointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId },
    });

    if (!existingAppointment) {
      return NextResponse.json(
        { error: "Cita no encontrada" },
        { status: 404 }
      );
    }

    if (existingAppointment.status === "cancelled") {
      return NextResponse.json(
        { error: "La cita ya está cancelada" },
        { status: 400 }
      );
    }

    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: "cancelled" },
    });

    revalidatePath("/");

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error cancelando cita:", error);
    return NextResponse.json(
      { error: "No se pudo cancelar la cita" },
      { status: 500 }
    );
  }
}