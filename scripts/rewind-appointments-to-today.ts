/**
 * Rewind script: actualiza Appointment.date de TODOS los appointments del
 * clinic activo a "hoy" (medianoche Madrid expresada como UTC), y resetea
 * RuntimeState.suggestionDecision a "pending".
 *
 * Motivacion (Sesion 18.5): el seed inicial cristalizo los appointments con
 * fecha del 30/04/2026. Al llamar a /api/orbital-state cualquier dia
 * posterior, getMadridDayBoundaries() devuelve la ventana de "hoy" y los
 * appointments del seed caen fuera -> agenda vacia.
 *
 * Idempotente: si los appointments ya estan en "hoy", no se modifican.
 *
 * Ejecutar:
 *   npx tsx --env-file=.env scripts/rewind-appointments-to-today.ts
 *
 * Multi-tenant: solo opera sobre el clinic devuelto por 1.
 *
 * Deuda blanda registrada (S18.5): SEED-APPOINTMENTS-FROZEN-TO-FIRST-RUN-V1.
 * Mitigacion provisional. La solucion estructural (seed dinamico o reseed
 * endpoint) se difiere hasta primer cliente piloto con datos reales que se
 * generen dia a dia.
 */

import { prismaAdmin as prisma } from "../lib/prisma";
import { getCurrentClinicId } from "../lib/tenant";

/**
 * Misma logica que getMadridDayBoundaries() de route.ts y adapter.ts, pero
 * devolviendo solo el "today" (no necesitamos "tomorrow" aqui).
 */
function getMadridTodayMidnightUTC(): Date {
  const now = new Date();

  const dateStringMadrid = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
  }).format(now);

  const offsetParts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Madrid",
    timeZoneName: "longOffset",
  }).formatToParts(now);
  const offsetStr =
    offsetParts.find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") ||
    "+00:00";

  return new Date(`${dateStringMadrid}T00:00:00${offsetStr}`);
}

async function main() {
  const clinicId = 1;
  const todayMidnightUTC = getMadridTodayMidnightUTC();

  console.log("\n=== Rewind appointments to today ===");
  console.log(`clinicId: ${clinicId}`);
  console.log(`today (Madrid midnight as UTC): ${todayMidnightUTC.toISOString()}`);
  console.log("");

  // --- 1. Cargar appointments del clinic ---
  const appointments = await prisma.appointment.findMany({
    where: { clinicId },
    select: { id: true, date: true, startTime: true, status: true },
    orderBy: { id: "asc" },
  });

  console.log(`Appointments encontrados en clinic ${clinicId}: ${appointments.length}`);

  if (appointments.length === 0) {
    console.log("Nada que mover. Verifica que el seed se ha ejecutado.");
    return;
  }

  // --- 2. Calcular y aplicar movimientos ---
  let moved = 0;
  let skipped = 0;

  for (const a of appointments) {
    if (a.date.getTime() === todayMidnightUTC.getTime()) {
      skipped++;
      continue;
    }
    await prisma.appointment.update({
      where: { id: a.id },
      data: { date: todayMidnightUTC },
    });
    moved++;
    console.log(
      `  moved id=${a.id} startTime=${a.startTime} status=${a.status} ` +
        `from=${a.date.toISOString()} to=${todayMidnightUTC.toISOString()}`,
    );
  }

  console.log("");
  console.log(`Resultado: ${moved} movidos, ${skipped} ya estaban en hoy.`);

  // --- 3. Resetear RuntimeState.suggestionDecision a "pending" ---
  // RuntimeState.id usa el mismo valor que clinicId por convencion del v7.3
  // (ver ensureSeeded en route.ts).
  const runtime = await prisma.runtimeState.findUnique({ where: { id: clinicId } });
  if (runtime === null) {
    console.log(`RuntimeState ${clinicId} no existe. Se creara en el proximo GET.`);
  } else if (runtime.suggestionDecision === "pending") {
    console.log(`RuntimeState.suggestionDecision ya estaba en "pending". Sin cambio.`);
  } else {
    await prisma.runtimeState.update({
      where: { id: clinicId },
      data: { suggestionDecision: "pending" },
    });
    console.log(
      `RuntimeState.suggestionDecision: "${runtime.suggestionDecision}" -> "pending"`,
    );
  }

  console.log("\n=== Rewind completado ===\n");
}

main()
  .catch((e) => {
    console.error("\nError en rewind:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());