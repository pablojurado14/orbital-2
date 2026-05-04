/**
 * Seedea la configuración del motor en ClinicSettings { id: 1 }.
 *
 * Sesión 18.5: introduce el primer parámetro per-tenant del clean core
 * sobre DB existente — el improvementThreshold del Coordinator (C6).
 *
 * Reaprovecha el campo `umbralDisparoProactivo` que ya existe en el schema
 * pero nunca fue conectado a código. Equivalencia semántica:
 *
 *   ClinicSettings.umbralDisparoProactivo  ≡  CoordinatorOptions.improvementThreshold
 *
 * Documentado como deuda blanda CLINIC-SETTINGS-FIELD-NAMING-V1: los campos
 * del clean core en ClinicSettings están en español (pesosKpi,
 * politicaAutonomia, umbralDisparoProactivo) pero el clean core usa nombres
 * en inglés (weights, autonomyPolicy, improvementThreshold). Renombrado
 * coherente planificado en Sesión 19/19.5.
 *
 * Valor seedeado: 0.001 (agresivo en propuestas, paridad funcional con
 * v7.3 legacy que no tiene threshold). Documentado como decisión rectora 10
 * del master.
 *
 * Idempotente: si ya está en 0.001, no hace nada.
 *
 * Ejecutar: npx tsx --env-file=.env scripts/seed-engine-config.ts
 */

import { prisma } from "../lib/prisma";
import { getCurrentClinicId } from "../lib/tenant";

const TARGET_THRESHOLD = 0.001;

async function main() {
  const clinicId = 1;

  console.log("\n=== Seed engine config (umbralDisparoProactivo) ===");
  console.log(`clinicId: ${clinicId}`);
  console.log(`target threshold: ${TARGET_THRESHOLD}`);
  console.log("");

  const before = await prisma.clinicSettings.findUnique({
    where: { id: clinicId },
    select: { umbralDisparoProactivo: true },
  });

  if (before === null) {
    console.error(
      `ClinicSettings { id: ${clinicId} } no existe. Ejecuta primero el seed inicial.`,
    );
    process.exit(1);
  }

  console.log(`umbralDisparoProactivo antes: ${before.umbralDisparoProactivo}`);

  if (before.umbralDisparoProactivo === TARGET_THRESHOLD) {
    console.log(`Ya está en ${TARGET_THRESHOLD}. Sin cambio.`);
    return;
  }

  await prisma.clinicSettings.update({
    where: { id: clinicId },
    data: { umbralDisparoProactivo: TARGET_THRESHOLD },
  });

  console.log(`umbralDisparoProactivo actualizado: null/otro -> ${TARGET_THRESHOLD}`);
  console.log("\n=== Seed completado ===\n");
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());