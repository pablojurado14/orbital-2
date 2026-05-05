/**
 * Wrapper para queries multi-tenant con RLS Postgres.
 *
 * Abre una transaccion, hace SET LOCAL app.current_clinic_id = N,
 * y ejecuta la funcion fn dentro del contexto. RLS de Postgres usa
 * ese setting para filtrar filas a las del tenant actual.
 *
 * Uso:
 *   const data = await withClinic(clinicId, async (tx) => {
 *     return tx.appointment.findMany({ ... });
 *   });
 *
 * Edge cases:
 * - clinicId debe ser un entero positivo (validamos antes de interpolar
 *   a SQL para mitigar SQL injection en SET LOCAL, que no acepta bind).
 * - Si fn lanza, la transaccion se aborta y SET LOCAL se revierte.
 * - Si el role es OWNER de las tablas, bypass RLS por defecto
 *   (deuda RLS-ROLE-OWNER-BYPASS-V1). El wrapper sigue funcionando.
 */

import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";

export type TenantTx = Prisma.TransactionClient;

export async function withClinic<T>(
  clinicId: number,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!Number.isInteger(clinicId) || clinicId <= 0) {
    throw new Error(
      `withClinic: clinicId debe ser un entero positivo, recibido: ${clinicId}`,
    );
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SET LOCAL app.current_clinic_id = ${clinicId}`,
    );
    return fn(tx);
  });
}