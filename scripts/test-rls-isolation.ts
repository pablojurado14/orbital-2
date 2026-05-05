/**
 * Test de aislamiento RLS — validación empírica de runtime.
 *
 * Sesión 19.6 fase E.5: con app_role no-owner ya activo en lib/prisma.ts,
 * este script demuestra que RLS Postgres realmente filtra a nivel de DB,
 * no solo a nivel de policy estructural.
 *
 * Tres tests:
 *   1. SIN withClinic (sin SET LOCAL) → queries devuelven 0 filas (RLS
 *      bloquea porque current_setting() es NULL y "clinicId = NULL" no
 *      matchea nada).
 *   2. CON withClinic(1) → queries devuelven datos de clínica 1.
 *   3. CON withClinic(999) (tenant inexistente) → queries devuelven 0
 *      filas (RLS aísla correctamente entre tenants).
 *
 * Si test 1 devuelve filas, RLS NO está enforcado en runtime — significa
 * que el role usado bypassea (deuda RLS-ROLE-OWNER-BYPASS-V1 no resuelta).
 * Confirmar que .env tiene DATABASE_URL_APP apuntando a app_role no-owner.
 *
 * Ejecutar: npx tsx --env-file=.env scripts/test-rls-isolation.ts
 */
 
import { prisma } from "../lib/prisma";
import { withClinic } from "../lib/tenant-prisma";
 
class IsolationAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IsolationAssertionError";
  }
}
 
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new IsolationAssertionError(message);
  }
}
 
async function main() {
    console.log("DATABASE_URL_APP set?", process.env.DATABASE_URL_APP ? "YES" : "NO");
  console.log("\n=== Test de aislamiento RLS ===\n");
  const whoami = await prisma.$queryRaw<Array<{ current_user: string; session_user: string }>>`SELECT current_user, session_user`;
  console.log(`Conectado como: ${whoami[0].current_user} (session: ${whoami[0].session_user})\n`);
 
  // ---- Test 1: SIN withClinic — RLS debe bloquear ----
  console.log("--- Test 1: queries SIN withClinic (sin SET LOCAL) ---");
  const patientCountNoCtx = await prisma.patient.count();
  const apptCountNoCtx = await prisma.appointment.count();
  const dentistCountNoCtx = await prisma.dentist.count();
  const gabineteCountNoCtx = await prisma.gabinete.count();
 
  console.log(`  Patient count: ${patientCountNoCtx}`);
  console.log(`  Appointment count: ${apptCountNoCtx}`);
  console.log(`  Dentist count: ${dentistCountNoCtx}`);
  console.log(`  Gabinete count: ${gabineteCountNoCtx}`);
 
  assert(
    patientCountNoCtx === 0 &&
      apptCountNoCtx === 0 &&
      dentistCountNoCtx === 0 &&
      gabineteCountNoCtx === 0,
    "Test 1 FALLO: queries devolvieron filas SIN SET LOCAL. " +
      "Significa que RLS NO esta enforcado en runtime — el role usado " +
      "bypassea las policies (probablemente sigue siendo OWNER). Verificar " +
      "que .env tiene DATABASE_URL_APP apuntando a app_role no-owner.",
  );
  console.log(`  OK RLS bloquea correctamente sin contexto de tenant`);
 
  // ---- Test 2: CON withClinic(1) — debe ver datos ----
  console.log("\n--- Test 2: queries CON withClinic(1) ---");
  await withClinic(1, async (tx) => {
    const patientCount = await tx.patient.count();
    const apptCount = await tx.appointment.count();
    const dentistCount = await tx.dentist.count();
    const gabineteCount = await tx.gabinete.count();
 
    console.log(`  Patient count: ${patientCount}`);
    console.log(`  Appointment count: ${apptCount}`);
    console.log(`  Dentist count: ${dentistCount}`);
    console.log(`  Gabinete count: ${gabineteCount}`);
 
    assert(
      patientCount > 0 &&
        apptCount > 0 &&
        dentistCount > 0 &&
        gabineteCount > 0,
      "Test 2 FALLO: queries con SET LOCAL=1 devolvieron 0 filas. " +
        "Posible causa: SET LOCAL no se propaga correctamente en " +
        "transaction (problema con PgBouncer transaction pooling) o " +
        "withClinic mal implementado.",
    );
    console.log(`  OK Datos visibles con SET LOCAL=1`);
  });
 
  // ---- Test 3: CON withClinic(999) — tenant inexistente, no debe ver nada ----
  console.log("\n--- Test 3: queries CON withClinic(999) (tenant inexistente) ---");
  await withClinic(999, async (tx) => {
    const patientCount = await tx.patient.count();
    const apptCount = await tx.appointment.count();
    const dentistCount = await tx.dentist.count();
 
    console.log(`  Patient count: ${patientCount}`);
    console.log(`  Appointment count: ${apptCount}`);
    console.log(`  Dentist count: ${dentistCount}`);
 
    assert(
      patientCount === 0 && apptCount === 0 && dentistCount === 0,
      "Test 3 FALLO: queries con SET LOCAL=999 devolvieron filas. " +
        "Significa que RLS no aisla correctamente entre tenants — un " +
        "tenant podria ver datos de otro.",
    );
    console.log(`  OK RLS aisla correctamente filas de otros tenants`);
  });
 
  console.log("\n=== Test de aislamiento: TODAS LAS ASSERTIONS PASARON ===");
  console.log("RLS Postgres esta enforcado en runtime con app_role no-owner.\n");
}
 
main()
  .catch((e) => {
    if (e instanceof IsolationAssertionError) {
      console.error(`\nERROR: ${e.message}\n`);
    } else {
      console.error("\nError inesperado:", e);
    }
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
 