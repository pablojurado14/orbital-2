/**
 * Migración: TreatmentType → Procedure references.
 *
 * Sesión 18, sub-fase 18.0. Pre-requisito del adapter del clean core.
 *
 * Hace dos cosas, ambas idempotentes:
 *
 *   1. Rellena WaitlistEntry.desiredProcedureId para entries con NULL,
 *      mapeando desde desiredTreatmentTypeId via la tabla TT_TO_PROCEDURE_CODE.
 *      WaitlistEntries con TreatmentType no mapeable se dejan en NULL y se
 *      logean como warning. El adapter v1 los tratará como "fuera de
 *      catálogo, sin matching de procedure".
 *
 *   2. Migra TreatmentType.price → ProcedureActivation.price para los
 *      Procedures con TreatmentType correspondiente. ProcedureActivations
 *      sin TreatmentType mapeado se dejan con price=NULL (correcto: no hay
 *      precio legacy de referencia).
 *
 * Mapeo TT_TO_PROCEDURE_CODE definido al inicio del archivo. Solo cubre
 * TreatmentTypes con correspondencia clara en el catálogo Procedure (Sesión
 * 11B). TreatmentTypes sin correspondencia (ej. "Férula de descarga",
 * "Implante rev.") quedan sin mapear hasta que se expanda el catálogo.
 *
 * Si una clínica tiene varios TreatmentTypes con el mismo nombre (no debería,
 * pero defensivamente), se procesa el primero por id ascendente.
 *
 * Idempotencia:
 *   - WaitlistEntry: solo se actualiza si desiredProcedureId está NULL.
 *   - ProcedureActivation: solo se actualiza si price está NULL.
 *
 * Re-ejecutar es seguro. 0 cambios si todo está ya migrado.
 *
 * Ejecutar: npx tsx --env-file=.env scripts/migrate-procedure-references.ts
 */

import { prisma } from "../lib/prisma";

// =============================================================================
// Mapeo TreatmentType.name → Procedure.code
// =============================================================================

/**
 * Mapeo determinista por nombre. Solo TreatmentTypes con correspondencia
 * clara en el catálogo Procedure (Sesión 11B).
 *
 * Decisiones tomadas:
 *   - "Empaste x3" → D2391 (mismo procedimiento, variante de cantidad).
 *   - "Implante rev." → SIN MAPEO. Es revisión post-implante, no está en
 *     catálogo como entry separada. Cuando se expanda, candidatos: D9310
 *     (consulta especialista) o nuevo Procedure code dedicado.
 *   - "Férula de descarga (toma)" / "(entrega y ajuste)" → SIN MAPEO.
 *     Procedimiento no incluido en el catálogo D-CDT actual.
 *   - "Endodoncia birradicular" → SIN MAPEO claro. Catálogo distingue
 *     unirradicular (D3310) y molar/multirradicular (D3330) pero no
 *     birradicular específica. Decisión diferida — no se mapea por ahora.
 */
const TT_TO_PROCEDURE_CODE: Readonly<Record<string, string>> = {
  Limpieza: "D1110",
  Revisión: "D0150",
  Empaste: "D2391",
  "Empaste x3": "D2391",
  Implante: "D6010",
  "Endodoncia unirradicular": "D3310",
  "Extracción simple": "D7140",
  "Extracción muela del juicio": "D7240",
  "Curetaje periodontal": "D4341",
  Blanqueamiento: "D9972",
  // Sin mapeo intencionado:
  //   "Implante rev.", "Férula de descarga (toma de medidas)",
  //   "Férula de descarga (entrega y ajuste)", "Endodoncia birradicular"
};

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("\n=== Migración TreatmentType → Procedure references ===\n");

  // ---- Paso 0: cargar Procedures por code para resolver IDs ----
  const procedures = await prisma.procedure.findMany({ where: { active: true } });
  const procedureIdByCode: Record<string, number> = {};
  for (const p of procedures) {
    procedureIdByCode[p.code] = p.id;
  }
  console.log(`✓ ${procedures.length} Procedures activos cargados.\n`);

  // ---- Paso 1: WaitlistEntry.desiredProcedureId ----
  console.log("--- Paso 1: WaitlistEntry.desiredProcedureId ---");
  const waitlistEntries = await prisma.waitlistEntry.findMany({
    where: { desiredProcedureId: null },
    include: { desiredTreatmentType: true, patient: true },
    orderBy: { id: "asc" },
  });
  console.log(
    `   ${waitlistEntries.length} WaitlistEntries con desiredProcedureId NULL.\n`
  );

  let waitlistMigrated = 0;
  let waitlistSkippedNoTT = 0;
  let waitlistSkippedNoMapping = 0;
  for (const w of waitlistEntries) {
    if (w.desiredTreatmentType === null) {
      console.log(
        `   ⚠ WaitlistEntry id=${w.id} (patient="${w.patient.name}"): sin TreatmentType. SKIP.`
      );
      waitlistSkippedNoTT++;
      continue;
    }
    const procedureCode = TT_TO_PROCEDURE_CODE[w.desiredTreatmentType.name];
    if (procedureCode === undefined) {
      console.log(
        `   ⚠ WaitlistEntry id=${w.id} (patient="${w.patient.name}", tt="${w.desiredTreatmentType.name}"): sin mapeo en catálogo. SKIP.`
      );
      waitlistSkippedNoMapping++;
      continue;
    }
    const procedureId = procedureIdByCode[procedureCode];
    if (procedureId === undefined) {
      console.log(
        `   ❌ WaitlistEntry id=${w.id}: mapeo apunta a code "${procedureCode}" pero no existe Procedure activo con ese código. SKIP.`
      );
      waitlistSkippedNoMapping++;
      continue;
    }
    await prisma.waitlistEntry.update({
      where: { id: w.id },
      data: { desiredProcedureId: procedureId },
    });
    console.log(
      `   ✓ WaitlistEntry id=${w.id} (patient="${w.patient.name}", tt="${w.desiredTreatmentType.name}") → Procedure code="${procedureCode}" id=${procedureId}`
    );
    waitlistMigrated++;
  }

  console.log(`
   Resumen Paso 1:
     ✓ Migradas:                  ${waitlistMigrated}
     ⚠ Sin TreatmentType:         ${waitlistSkippedNoTT}
     ⚠ Sin mapeo en catálogo:     ${waitlistSkippedNoMapping}
     ─────────────────────────────
     Total candidatas:           ${waitlistEntries.length}
`);

  // ---- Paso 2: ProcedureActivation.price ----
  console.log("--- Paso 2: ProcedureActivation.price ---");
  const activations = await prisma.procedureActivation.findMany({
    where: { price: null, active: true },
    include: { procedure: true },
    orderBy: { id: "asc" },
  });
  console.log(`   ${activations.length} ProcedureActivations con price NULL.\n`);

  // Pre-cargamos TreatmentTypes con su clinicId para resolver precio.
  const treatmentTypes = await prisma.treatmentType.findMany({ where: { active: true } });
  // Construir mapa: clinicId × procedureCode → price
  // (tomando el primer TT encontrado por nombre que mapee a ese code)
  const priceByClinicAndProcedureCode = new Map<string, number>();
  for (const tt of treatmentTypes) {
    const code = TT_TO_PROCEDURE_CODE[tt.name];
    if (code === undefined) continue;
    if (tt.price === null) continue;
    if (tt.clinicId === null) continue;
    const key = `${tt.clinicId}:${code}`;
    if (!priceByClinicAndProcedureCode.has(key)) {
      priceByClinicAndProcedureCode.set(key, tt.price);
    }
  }

  let activationsMigrated = 0;
  let activationsSkippedNoLegacy = 0;
  for (const act of activations) {
    const key = `${act.clinicId}:${act.procedure.code}`;
    const legacyPrice = priceByClinicAndProcedureCode.get(key);
    if (legacyPrice === undefined) {
      console.log(
        `   ⊘ ProcedureActivation id=${act.id} (procedureCode="${act.procedure.code}", clinicId=${act.clinicId}): sin TreatmentType legacy con precio mapeable. SKIP.`
      );
      activationsSkippedNoLegacy++;
      continue;
    }
    await prisma.procedureActivation.update({
      where: { id: act.id },
      data: { price: legacyPrice },
    });
    console.log(
      `   ✓ ProcedureActivation id=${act.id} (procedureCode="${act.procedure.code}") → price=${legacyPrice} EUR`
    );
    activationsMigrated++;
  }

  console.log(`
   Resumen Paso 2:
     ✓ Precios migrados:          ${activationsMigrated}
     ⊘ Sin precio legacy mapeable: ${activationsSkippedNoLegacy}
     ─────────────────────────────
     Total candidatas:           ${activations.length}
`);

  // ---- Verificación final ----
  const remainingNullProcedureId = await prisma.waitlistEntry.count({
    where: { desiredProcedureId: null },
  });
  const remainingNullPrice = await prisma.procedureActivation.count({
    where: { price: null, active: true },
  });
  console.log("=== Verificación final ===");
  console.log(`   WaitlistEntries con desiredProcedureId NULL: ${remainingNullProcedureId}`);
  console.log(`   ProcedureActivations activas con price NULL: ${remainingNullPrice}\n`);
}

main()
  .catch((e) => {
    console.error("❌ Error en migración:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());