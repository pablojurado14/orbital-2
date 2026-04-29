/**
 * Backfill: Patient.waiting* → WaitlistEntry (Sesión 11D).
 *
 * Migra los pacientes con inWaitingList=true a la nueva tabla WaitlistEntry,
 * dejando los campos waiting* de Patient INTACTOS (sigue leyéndolos motor v7.3).
 *
 * Convivencia hasta Sesión 18:
 *   - Patient.waiting* lo lee motor v7.3 (legacy).
 *   - WaitlistEntry lo leerá clean core (Sesiones 12-17, dormido hasta 18).
 *   - Deuda registrada: WAITLIST-DUAL-COLUMNS-S18, WAITLIST-RESYNC-S18.
 *   - En Sesión 18 se vuelve a ejecutar este backfill (con upsert) para
 *     capturar cualquier cambio entre 11D y 18, y se borran las columnas viejas.
 *
 * Mapeo:
 *   Patient.waitingTreatmentId    → WaitlistEntry.desiredTreatmentTypeId
 *   Patient.waitingDurationSlots  → WaitlistEntry.durationSlots
 *   Patient.waitingValue          → WaitlistEntry.value
 *   Patient.waitingCurrency       → WaitlistEntry.currency
 *   Patient.priority              → WaitlistEntry.priority
 *   Patient.availableNow          → WaitlistEntry.availableNow
 *   Patient.easeScore             → WaitlistEntry.easeScore
 *   Patient.clinicId              → WaitlistEntry.clinicId
 *   (urgency, availabilityWindow, expiresAt, preferredContactChannel,
 *    desiredProcedureId quedan en valores por defecto / NULL — no hay datos legacy)
 *
 * Idempotencia:
 *   - Si ya existe AL MENOS UN WaitlistEntry para un paciente, se asume migrado y se salta.
 *   - Re-ejecutar es seguro: 0 cambios si todo está ya migrado.
 *
 * Validaciones:
 *   - Paciente con inWaitingList=true pero waitingDurationSlots o waitingValue NULL
 *     se reporta como WARNING y se salta (no se puede migrar entry incompleta).
 *   - Paciente sin clinicId se reporta como WARNING y se salta (no debería existir
 *     post Sesión 11A, pero defensivo).
 *
 * Ejecutar: npx tsx --env-file=.env scripts/backfill-waitlist.ts
 */

import { prisma } from "../lib/prisma";

async function main() {
  console.log("\n🔧 Backfill waitlist: Patient.waiting* → WaitlistEntry\n");

  const candidates = await prisma.patient.findMany({
    where: { inWaitingList: true },
    orderBy: { id: "asc" },
  });

  console.log(`   Pacientes con inWaitingList=true encontrados: ${candidates.length}\n`);

  let migrated = 0;
  let skippedAlreadyMigrated = 0;
  let skippedIncomplete = 0;
  let skippedNoClinic = 0;

  for (const p of candidates) {
    // Skip si no tiene clinicId
    if (p.clinicId === null) {
      console.log(`   ⚠️  Patient id=${p.id} (${p.name}): sin clinicId. SKIP.`);
      skippedNoClinic++;
      continue;
    }

    // Skip si datos de waitlist incompletos
    if (p.waitingDurationSlots === null || p.waitingValue === null) {
      console.log(
        `   ⚠️  Patient id=${p.id} (${p.name}): waitingDurationSlots=${p.waitingDurationSlots}, waitingValue=${p.waitingValue}. Datos incompletos. SKIP.`
      );
      skippedIncomplete++;
      continue;
    }

    // Skip idempotente si ya tiene al menos una entry
    const existing = await prisma.waitlistEntry.findFirst({
      where: { patientId: p.id },
    });
    if (existing !== null) {
      console.log(
        `   ⊘  Patient id=${p.id} (${p.name}): ya tiene WaitlistEntry id=${existing.id}. SKIP.`
      );
      skippedAlreadyMigrated++;
      continue;
    }

    // Crear entry
    await prisma.waitlistEntry.create({
      data: {
        clinicId: p.clinicId,
        patientId: p.id,
        desiredProcedureId: null, // se mapea en Sesión 18
        desiredTreatmentTypeId: p.waitingTreatmentId,
        durationSlots: p.waitingDurationSlots,
        value: p.waitingValue,
        currency: p.waitingCurrency,
        priority: p.priority,
        availableNow: p.availableNow,
        easeScore: p.easeScore,
        // Resto de campos quedan a default / NULL
      },
    });

    console.log(`   ✓  Patient id=${p.id} (${p.name}) → WaitlistEntry creada`);
    migrated++;
  }

  console.log(`
📊 Resumen:
   ✓ Migradas:                 ${migrated}
   ⊘ Ya migradas (idempot.):   ${skippedAlreadyMigrated}
   ⚠ Datos incompletos:        ${skippedIncomplete}
   ⚠ Sin clinicId:             ${skippedNoClinic}
   ───────────────────────────
   Total candidatos:           ${candidates.length}
`);

  // Verificación final
  const totalEntries = await prisma.waitlistEntry.count();
  console.log(`✨ Total WaitlistEntry en DB tras backfill: ${totalEntries}\n`);
}

main()
  .catch((e) => {
    console.error("❌ Error en backfill:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());