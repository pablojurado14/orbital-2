"use server";

import { prisma } from "@/lib/prisma";
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
    await prisma.daySchedule.update({
      where: { id: data.id },
      data: {
        isOpen: data.isOpen,
        morningOpen: data.isOpen ? data.morningOpen : null,
        morningClose: data.isOpen ? data.morningClose : null,
        afternoonOpen: data.isOpen ? data.afternoonOpen : null,
        afternoonClose: data.isOpen ? data.afternoonClose : null,
      },
    });
    revalidatePath("/settings/horarios");
    return { success: true };
  } catch (error) {
    console.error("Error saving horario:", error);
    return { success: false, error: "Error al guardar el horario." };
  }
}
