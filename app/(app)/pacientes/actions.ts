"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

type SaveResult = { success: true } | { success: false; error: string };

export async function savePatient(data: {
  id?: number;
  name: string;
  phone: string | null;
  inWaitingList: boolean;
  preferredGabineteId?: number | null;
  preferredDentistId?: number | null;
  waitingTreatmentId?: number | null;
  waitingDurationSlots?: number | null;
  waitingValue?: number | null;
  priority?: number;
  availableNow?: boolean;
  easeScore?: number;
}): Promise<SaveResult> {
  try {
    const waitingFields = data.inWaitingList
      ? {
          waitingTreatmentId: data.waitingTreatmentId ?? null,
          waitingDurationSlots: data.waitingDurationSlots ?? null,
          waitingValue: data.waitingValue ?? null,
          priority: data.priority ?? 3,
          availableNow: data.availableNow ?? true,
          easeScore: data.easeScore ?? 3,
        }
      : {
          waitingTreatmentId: null,
          waitingDurationSlots: null,
          waitingValue: null,
          priority: 1,
          availableNow: true,
          easeScore: 5,
        };

    const persisted = {
      name: data.name,
      phone: data.phone,
      inWaitingList: data.inWaitingList,
      preferredGabineteId: data.preferredGabineteId ?? null,
      preferredDentistId: data.preferredDentistId ?? null,
      ...waitingFields,
    };

    if (data.id) {
      await prisma.patient.update({
        where: { id: data.id },
        data: persisted,
      });
    } else {
      await prisma.patient.create({
        data: persisted,
      });
    }

    revalidatePath("/pacientes");
    revalidatePath("/");
    revalidatePath("/citas");
    return { success: true };
  } catch (error) {
    const err = error as { code?: string; meta?: { target?: string[] | string } };
    if (err?.code === "P2002") {
      const target = Array.isArray(err.meta?.target)
        ? err.meta.target.join(", ")
        : err.meta?.target ?? "campo";
      return { success: false, error: `Ya existe un paciente con ese ${target}.` };
    }
    console.error("Error guardando paciente:", error);
    return { success: false, error: "Error al gestionar el paciente." };
  }
}