"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import { revalidatePath } from "next/cache";

export async function saveDentist(data: {
  id?: number;
  name: string;
  specialty?: string;
  active: boolean;
}) {
  try {
    const clinicId = await getCurrentClinicId();

    if (data.id) {
      const result = await prisma.dentist.updateMany({
        where: { id: data.id, clinicId },
        data: {
          name: data.name,
          specialty: data.specialty || null,
          active: data.active,
        },
      });
      if (result.count === 0) {
        return { success: false, error: "Dentista no encontrado." };
      }
    } else {
      await prisma.dentist.create({
        data: {
          name: data.name,
          specialty: data.specialty || null,
          active: data.active,
          clinicId,
        },
      });
    }
    revalidatePath("/settings/dentistas");
    return { success: true };
  } catch (error) {
    const err = error as { code?: string; meta?: { target?: string[] | string } };
    if (err?.code === "P2002") {
      const target = Array.isArray(err.meta?.target)
        ? err.meta.target.join(", ")
        : err.meta?.target ?? "campo";
      return { success: false, error: `Ya existe un dentista con ese ${target}.` };
    }
    console.error("Error saving dentist:", error);
    return { success: false, error: "Error al guardar el dentista." };
  }
}

export async function deleteDentist(id: number) {
  try {
    const clinicId = await getCurrentClinicId();

    const hasAppointments = await prisma.appointment.findFirst({
      where: { dentistId: id, clinicId },
    });
    if (hasAppointments) {
      const r = await prisma.dentist.updateMany({
        where: { id, clinicId },
        data: { active: false },
      });
      if (r.count === 0) {
        return { success: false, error: "Dentista no encontrado." };
      }
      revalidatePath("/settings/dentistas");
      return { success: true, message: "Dentista desactivado por tener histórico de citas." };
    }
    const r = await prisma.dentist.deleteMany({ where: { id, clinicId } });
    if (r.count === 0) {
      return { success: false, error: "Dentista no encontrado." };
    }
    revalidatePath("/settings/dentistas");
    return { success: true };
  } catch (error) {
    console.error("Error deleting dentist:", error);
    return { success: false, error: "No se pudo eliminar." };
  }
}