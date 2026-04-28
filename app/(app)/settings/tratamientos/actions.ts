"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function saveTratamiento(data: {
  id?: number;
  name: string;
  duration: number;
  price: number | null;
  active: boolean;
}) {
  try {
    if (data.id) {
      await prisma.treatmentType.update({
        where: { id: data.id },
        data: {
          name: data.name,
          duration: data.duration,
          price: data.price,
          active: data.active,
        },
      });
    } else {
      await prisma.treatmentType.create({
        data: {
          name: data.name,
          duration: data.duration,
          price: data.price,
          active: data.active,
        },
      });
    }
    revalidatePath("/settings/tratamientos");
    return { success: true };
  } catch (error) {
    const err = error as { code?: string; meta?: { target?: string[] | string } };
    if (err?.code === "P2002") {
      return { success: false, error: `Ya existe un tratamiento con ese nombre.` };
    }
    console.error("Error saving tratamiento:", error);
    return { success: false, error: "No se pudo guardar el tratamiento." };
  }
}

export async function deleteTratamiento(id: number) {
  try {
    const hasAppointments = await prisma.appointment.findFirst({ where: { treatmentTypeId: id } });
    const hasWaiting = await prisma.patient.findFirst({ where: { waitingTreatmentId: id } });

    if (hasAppointments || hasWaiting) {
      await prisma.treatmentType.update({ where: { id }, data: { active: false } });
      revalidatePath("/settings/tratamientos");
      return {
        success: true,
        message: "Tratamiento desactivado (tiene citas o pacientes asociados).",
      };
    }

    await prisma.treatmentType.delete({ where: { id } });
    revalidatePath("/settings/tratamientos");
    return { success: true };
  } catch (error) {
    console.error("Error deleting tratamiento:", error);
    return { success: false, error: "Error interno al eliminar el tratamiento." };
  }
}