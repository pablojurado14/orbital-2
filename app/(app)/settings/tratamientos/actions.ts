"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import { revalidatePath } from "next/cache";

export async function saveTratamiento(data: {
  id?: number;
  name: string;
  duration: number;
  price: number | null;
  active: boolean;
}) {
  try {
    const clinicId = getCurrentClinicId();

    if (data.id) {
      const result = await prisma.treatmentType.updateMany({
        where: { id: data.id, clinicId },
        data: {
          name: data.name,
          duration: data.duration,
          price: data.price,
          active: data.active,
        },
      });
      if (result.count === 0) {
        return { success: false, error: "Tratamiento no encontrado." };
      }
    } else {
      await prisma.treatmentType.create({
        data: {
          name: data.name,
          duration: data.duration,
          price: data.price,
          active: data.active,
          clinicId,
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
    const clinicId = getCurrentClinicId();

    const hasAppointments = await prisma.appointment.findFirst({
      where: { treatmentTypeId: id, clinicId },
    });
    // S19.B: la check pasa de Patient.waitingTreatmentId a
    // WaitlistEntry.desiredTreatmentTypeId. Patient ya no tiene columnas waiting*.
    const hasWaiting = await prisma.waitlistEntry.findFirst({
      where: { desiredTreatmentTypeId: id, clinicId },
    });

    if (hasAppointments || hasWaiting) {
      const r = await prisma.treatmentType.updateMany({
        where: { id, clinicId },
        data: { active: false },
      });
      if (r.count === 0) {
        return { success: false, error: "Tratamiento no encontrado." };
      }
      revalidatePath("/settings/tratamientos");
      return {
        success: true,
        message: "Tratamiento desactivado (tiene citas o pacientes asociados).",
      };
    }

    const r = await prisma.treatmentType.deleteMany({ where: { id, clinicId } });
    if (r.count === 0) {
      return { success: false, error: "Tratamiento no encontrado." };
    }
    revalidatePath("/settings/tratamientos");
    return { success: true };
  } catch (error) {
    console.error("Error deleting tratamiento:", error);
    return { success: false, error: "Error interno al eliminar el tratamiento." };
  }
}