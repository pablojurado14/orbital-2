/**
 * Tenant actual de la clínica.
 *
 * Hasta Sesión 20 (multi-tenant real con auth), todas las operaciones
 * asumen una única clínica con id=1. Cuando entre auth, esta función
 * leerá el clinicId del session/JWT del usuario y todos los callers
 * seguirán llamándola igual.
 *
 * Reglas:
 *  - Todo prisma.X.create({ data: {...} }) debe incluir clinicId: getCurrentClinicId()
 *  - Todo prisma.X.findMany() debe filtrar where: { clinicId: getCurrentClinicId() }
 *  - Todo prisma.X.findFirst/findUnique debe incluir clinicId en el where
 *  - Todo prisma.X.update/delete debe filtrar por clinicId además del id
 */
export function getCurrentClinicId(): number {
  return 1;
}