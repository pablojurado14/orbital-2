import { auth } from "@/auth";

/**
 * Tenant actual de la clínica.
 *
 * Sesión 19.5: leído del session JWT del usuario autenticado. El middleware
 * de Auth.js garantiza que ninguna ruta protegida llega aquí sin sesión,
 * pero por defensa lanzamos si por algún path no esperado falta clinicId.
 *
 * Reglas (sin cambios desde S11A):
 *  - Todo prisma.X.create({ data: {...} }) debe incluir clinicId: await getCurrentClinicId()
 *  - Todo prisma.X.findMany() debe filtrar where: { clinicId: await getCurrentClinicId() }
 *  - Todo prisma.X.findFirst/findUnique debe incluir clinicId en el where
 *  - Todo prisma.X.update/delete debe filtrar por clinicId además del id
 */
export async function getCurrentClinicId(): Promise<number> {
  const session = await auth();
  const clinicId = (session?.user as { clinicId?: number } | undefined)?.clinicId;
  if (typeof clinicId !== "number") {
    throw new Error(
      "getCurrentClinicId: no hay clinicId en la sesión. ¿Llamada fuera de ruta autenticada?",
    );
  }
  return clinicId;
}