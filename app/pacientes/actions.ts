"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function savePatient(data: { 
  id?: number; 
  name: string; 
  phone: string; 
  inWaitingList: boolean;
  preferredGabineteId?: number | null;
  preferredDentistId?: number | null;
}) {
  try {
    if (data.id) {
      await prisma.patient.update({
        where: { id: data.id },
        data: { 
          name: data.name, 
          phone: data.phone, 
          inWaitingList: data.inWaitingList,
          preferredGabineteId: data.preferredGabineteId || null,
          preferredDentistId: data.preferredDentistId || null
        },
      });
    } else {
      await prisma.patient.create({
        data: { 
          name: data.name, 
          phone: data.phone, 
          inWaitingList: data.inWaitingList,
          preferredGabineteId: data.preferredGabineteId || null,
          preferredDentistId: data.preferredDentistId || null
        },
      });
    }
    revalidatePath("/pacientes");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    return { success: false, error: "Error al gestionar el paciente." };
  }
}
