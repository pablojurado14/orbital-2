"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import { revalidatePath } from "next/cache";

type SaveResult = { success: true } | { success: false; error: string };
type DeleteResult =
  | { success: true; mode: "hard" | "soft" }
  | { success: false; error: string };

export async function savePatient(data: {
  id?: number;
  waitlistEntryId?: number | null;
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
    const clinicId = getCurrentClinicId();

    // S19.B: Patient.waiting* eliminados. La entrada en lista de espera vive
    // en WaitlistEntry. Decisión 1:1 lógica: un paciente o tiene una entry
    // activa, o ninguna. Múltiples entries simultáneas no están permitidas
    // por la UI actual (capacidad latente del schema, post-piloto).
    const patientFields = {
      name: data.name,
      phone: data.phone,
      preferredGabineteId: data.preferredGabineteId ?? null,
      preferredDentistId: data.preferredDentistId ?? null,
    };

    await prisma.$transaction(async (tx) => {
      let patientId: number;
      if (data.id) {
        const result = await tx.patient.updateMany({
          where: { id: data.id, clinicId, active: true },
          data: patientFields,
        });
        if (result.count === 0) {
          throw new Error("PATIENT_NOT_FOUND");
        }
        patientId = data.id;
      } else {
        const created = await tx.patient.create({
          data: { ...patientFields, clinicId },
        });
        patientId = created.id;
      }

      if (data.inWaitingList) {
        const waitlistFields = {
          clinicId,
          patientId,
          desiredTreatmentTypeId: data.waitingTreatmentId ?? null,
          desiredProcedureId: null,
          durationSlots: data.waitingDurationSlots ?? 1,
          value: data.waitingValue ?? 0,
          priority: data.priority ?? 3,
          availableNow: data.availableNow ?? true,
          easeScore: data.easeScore ?? 3,
        };

        if (data.waitlistEntryId) {
          const result = await tx.waitlistEntry.updateMany({
            where: { id: data.waitlistEntryId, clinicId },
            data: waitlistFields,
          });
          if (result.count === 0) {
            throw new Error("WAITLIST_ENTRY_NOT_FOUND");
          }
        } else {
          await tx.waitlistEntry.create({ data: waitlistFields });
        }
      } else {
        await tx.waitlistEntry.deleteMany({
          where: { patientId, clinicId },
        });
      }
    });

    revalidatePath("/pacientes");
    revalidatePath("/");
    revalidatePath("/citas");
    return { success: true };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "PATIENT_NOT_FOUND") {
        return { success: false, error: "Paciente no encontrado o no pertenece a esta clínica." };
      }
      if (error.message === "WAITLIST_ENTRY_NOT_FOUND") {
        return { success: false, error: "Entrada en lista de espera no encontrada." };
      }
    }
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

/**
 * S19.B: eliminar paciente. Lógica análoga a deleteTratamiento:
 *   - Si el paciente tiene citas (históricas o futuras): soft delete
 *     (active=false). Las citas se mantienen para trazabilidad y análisis.
 *     También se borran sus WaitlistEntries (no tiene sentido mantener una
 *     entry de un paciente "dado de baja").
 *   - Si no tiene citas: hard delete + cleanup de WaitlistEntries.
 *
 * Devuelve { mode: "hard" | "soft" } para que la UI pueda mostrar mensaje
 * informativo distinto.
 */
export async function deletePatient(id: number): Promise<DeleteResult> {
  try {
    const clinicId = getCurrentClinicId();

    const hasAppointments = await prisma.appointment.findFirst({
      where: { patientId: id, clinicId },
    });

    if (hasAppointments) {
      await prisma.$transaction(async (tx) => {
        const r = await tx.patient.updateMany({
          where: { id, clinicId, active: true },
          data: { active: false },
        });
        if (r.count === 0) {
          throw new Error("PATIENT_NOT_FOUND");
        }
        await tx.waitlistEntry.deleteMany({
          where: { patientId: id, clinicId },
        });
      });
      revalidatePath("/pacientes");
      revalidatePath("/");
      revalidatePath("/citas");
      return { success: true, mode: "soft" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.waitlistEntry.deleteMany({
        where: { patientId: id, clinicId },
      });
      const r = await tx.patient.deleteMany({
        where: { id, clinicId, active: true },
      });
      if (r.count === 0) {
        throw new Error("PATIENT_NOT_FOUND");
      }
    });
    revalidatePath("/pacientes");
    revalidatePath("/");
    revalidatePath("/citas");
    return { success: true, mode: "hard" };
  } catch (error) {
    if (error instanceof Error && error.message === "PATIENT_NOT_FOUND") {
      return { success: false, error: "Paciente no encontrado o no pertenece a esta clínica." };
    }
    console.error("Error eliminando paciente:", error);
    return { success: false, error: "Error al eliminar el paciente." };
  }
}