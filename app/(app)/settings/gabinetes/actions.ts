"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import { revalidatePath } from "next/cache";

export async function saveGabinete(data: {
  id?: number;
  name: string;
  description?: string;
  active: boolean;
}) {
  try {
    const clinicId = await getCurrentClinicId();

    if (data.id) {
      const result = await prisma.gabinete.updateMany({
        where: { id: data.id, clinicId },
        data: {
          name: data.name,
          description: data.description || null,
          active: data.active,
        },
      });
      if (result.count === 0) {
        return { success: false, error: "Gabinete no encontrado." };
      }
    } else {
      await prisma.gabinete.create({
        data: {
          name: data.name,
          description: data.description || null,
          active: data.active,
          clinicId,
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
    const clinicId = await getCurrentClinicId();

    const hasAppointments = await prisma.appointment.findFirst({
      where: { gabineteId: id, clinicId },
    });
    const hasPatients = await prisma.patient.findFirst({
      where: { preferredGabineteId: id, clinicId },
    });

    if (hasAppointments || hasPatients) {
      const r = await prisma.gabinete.updateMany({
        where: { id, clinicId },
        data: { active: false },
      });
      if (r.count === 0) {
        return { success: false, error: "Gabinete no encontrado." };
      }
      revalidatePath("/settings/gabinetes");
      return {
        success: true,
        message: "El gabinete tiene citas o pacientes asociados. Se ha desactivado para proteger el historial.",
      };
    }

    const r = await prisma.gabinete.deleteMany({ where: { id, clinicId } });
    if (r.count === 0) {
      return { success: false, error: "Gabinete no encontrado." };
    }
    revalidatePath("/settings/gabinetes");
    return { success: true };
  } catch (error) {
    console.error("Error deleting gabinete:", error);
    return { success: false, error: "Error interno al intentar eliminar el gabinete." };
  }
}