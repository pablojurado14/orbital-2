"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import { revalidatePath } from "next/cache";

export async function saveHorario(data: {
  id: number;
  isOpen: boolean;
  morningOpen: string | null;
  morningClose: string | null;
  afternoonOpen: string | null;
  afternoonClose: string | null;
}) {
  try {
    const clinicId = await getCurrentClinicId();

    const result = await prisma.daySchedule.updateMany({
      where: { id: data.id, clinicId },
      data: {
        isOpen: data.isOpen,
        morningOpen: data.isOpen ? data.morningOpen : null,
        morningClose: data.isOpen ? data.morningClose : null,
        afternoonOpen: data.isOpen ? data.afternoonOpen : null,
        afternoonClose: data.isOpen ? data.afternoonClose : null,
      },
    });
    if (result.count === 0) {
      return { success: false, error: "Horario no encontrado." };
    }
    revalidatePath("/settings/horarios");
    return { success: true };
  } catch (error) {
    console.error("Error saving horario:", error);
    return { success: false, error: "Error al guardar el horario." };
  }
}