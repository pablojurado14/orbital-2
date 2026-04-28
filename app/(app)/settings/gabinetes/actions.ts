"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function saveGabinete(data: {
  id?: number;
  name: string;
  description?: string;
  active: boolean;
}) {
  try {
    if (data.id) {
      await prisma.gabinete.update({
        where: { id: data.id },
        data: {
          name: data.name,
          description: data.description || null,
          active: data.active,
        },
      });
    } else {
      await prisma.gabinete.create({
        data: {
          name: data.name,
          description: data.description || null,
          active: data.active,
        },
      });
    }

    revalidatePath("/settings/gabinetes");
    return { success: true };
  } catch (error) {
    const err = error as { code?: string; meta?: { target?: string[] | string } };
    if (err?.code === "P2002") {
      return { success: false, error: `Ya existe un gabinete con ese nombre.` };
    }
    console.error("Error saving gabinete:", error);
    return { success: false, error: "No se pudo guardar el gabinete." };
  }
}

export async function deleteGabinete(id: number) {
  try {
    const hasAppointments = await prisma.appointment.findFirst({ where: { gabineteId: id } });
    const hasPatients = await prisma.patient.findFirst({ where: { preferredGabineteId: id } });

    if (hasAppointments || hasPatients) {
      await prisma.gabinete.update({
        where: { id },
        data: { active: false },
      });
      revalidatePath("/settings/gabinetes");
      return {
        success: true,
        message: "El gabinete tiene citas o pacientes asociados. Se ha desactivado para proteger el historial.",
      };
    }

    await prisma.gabinete.delete({ where: { id } });
    revalidatePath("/settings/gabinetes");
    return { success: true };
  } catch (error) {
    console.error("Error deleting gabinete:", error);
    return { success: false, error: "Error interno al intentar eliminar el gabinete." };
  }
}