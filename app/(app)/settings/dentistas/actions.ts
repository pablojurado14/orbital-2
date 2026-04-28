"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function saveDentist(data: {
  id?: number;
  name: string;
  specialty?: string;
  active: boolean;
}) {
  try {
    if (data.id) {
      await prisma.dentist.update({
        where: { id: data.id },
        data: {
          name: data.name,
          specialty: data.specialty || null,
          active: data.active,
        },
      });
    } else {
      await prisma.dentist.create({
        data: {
          name: data.name,
          specialty: data.specialty || null,
          active: data.active,
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
    const hasAppointments = await prisma.appointment.findFirst({ where: { dentistId: id } });
    if (hasAppointments) {
      await prisma.dentist.update({ where: { id }, data: { active: false } });
      revalidatePath("/settings/dentistas");
      return { success: true, message: "Dentista desactivado por tener histórico de citas." };
    }
    await prisma.dentist.delete({ where: { id } });
    revalidatePath("/settings/dentistas");
    return { success: true };
  } catch (error) {
    console.error("Error deleting dentist:", error);
    return { success: false, error: "No se pudo eliminar." };
  }
}