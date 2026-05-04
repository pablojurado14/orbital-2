/**
 * Inspecciona el estado actual de ClinicSettings { id: 1 } en DB.
 * Diagnóstico previo a Sesión 18.5 — verificar valor de umbralDisparoProactivo
 * antes de seedearlo a 0.001 como improvementThreshold del Coordinator.
 *
 * Ejecutar: npx tsx --env-file=.env scripts/inspect-clinic-settings.ts
 */

import { prisma } from "../lib/prisma";

async function main() {
  const c = await prisma.clinicSettings.findUnique({ where: { id: 1 } });
  if (c === null) {
    console.log("ClinicSettings { id: 1 } NO existe en DB.");
    return;
  }
  console.log(JSON.stringify(c, null, 2));
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());