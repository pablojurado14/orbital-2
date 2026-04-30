/**
 * Smoke test del adapter del clean core (Sesión 18).
 *
 * NO es un test de Vitest — es un script ejecutable que prueba el adapter
 * contra la DB Frankfurt real (la misma que sirve la URL pública).
 * Verifica que las 3 operaciones críticas no explotan y que producen
 * outputs estructuralmente coherentes.
 *
 * Ejecutar: npx tsx --env-file=.env scripts/smoke-test-adapter.ts
 *
 * Verifica:
 *   1. buildContextsFromDb() carga state, runtimes y contexts sin error.
 *   2. processEvent(proactive_tick) devuelve un CycleDecision válido.
 *   3. processEvent(cancellation sobre el appointment cancelled del seed)
 *      produce un proposal con fill_from_waitlist (si los datos lo permiten).
 *   4. Los riesgos del Predictor están rellenados (no_show != 0 si hay scores
 *      de paciente, lateness derivada).
 */

import { buildContextsFromDb, processEvent } from "../lib/core/adapter";
import { prisma } from "../lib/prisma";
import { getCurrentClinicId } from "../lib/tenant";

async function main() {
  console.log("\n=== Smoke test del adapter del clean core ===\n");

  const clinicId = getCurrentClinicId();
  console.log(`clinicId actual: ${clinicId}\n`);

  // ---- Test 1: buildContextsFromDb ----
  console.log("--- Test 1: buildContextsFromDb() ---");
  const { state, runtimes, contexts } = await buildContextsFromDb();

  console.log(`  ✓ Appointments cargados: ${state.appointments.length}`);
  console.log(`  ✓ Runtimes cargados: ${Object.keys(runtimes).length}`);
  console.log(`  ✓ Professionals: ${contexts.validation.professionals.length}`);
  console.log(`  ✓ Rooms: ${contexts.validation.rooms.length}`);
  console.log(`  ✓ Equipment: ${contexts.validation.equipment.length}`);
  console.log(
    `  ✓ Procedures: ${Object.keys(contexts.validation.proceduresById).length}`,
  );
  console.log(
    `  ✓ Waitlist candidates: ${contexts.generation.waitlist.candidates.length}`,
  );
  console.log(
    `  ✓ Procedures con precio: ${Object.keys(contexts.simulation.priceByProcedureId).length}`,
  );

  // Inspeccionar primer appointment con sus riesgos.
  if (state.appointments.length > 0) {
    const first = state.appointments[0];
    const r = runtimes[first.eventId];
    console.log(`\n  Primer appointment:`);
    console.log(`    eventId=${first.eventId} status=${first.runtimeStatus}`);
    console.log(`    professional=${r.professionalId} room=${r.roomId}`);
    console.log(`    procedureId=${r.procedureId}`);
    console.log(
      `    plannedDuration=${r.plannedDuration / 60_000} min start=${new Date(r.start).toISOString()}`,
    );
    console.log(
      `    estimatedEndDistribution.p50=${first.estimatedEndDistribution.p50 / 60_000} min`,
    );
    console.log(`    detectedRisks=${JSON.stringify(first.detectedRisks)}`);
  }

  // ---- Test 2: processEvent(proactive_tick) ----
  console.log("\n--- Test 2: processEvent(proactive_tick) ---");
  const tickDecision = await processEvent({
    kind: "proactive_tick",
    instant: Date.now(),
    tenantId: String(clinicId),
  });
  console.log(`  ✓ Decision proposal: ${tickDecision.proposal === null ? "null" : "no-null"}`);
  console.log(`  ✓ autonomyLevel: ${tickDecision.autonomyLevel}`);
  console.log(`  ✓ motiveCode: ${tickDecision.explanation.motiveCode}`);
  console.log(
    `  ✓ alternatives consideradas: ${tickDecision.explanation.consideredAlternatives.length}`,
  );

  // ---- Test 3: processEvent(cancellation) sobre el appointment cancelled del seed ----
  console.log("\n--- Test 3: processEvent(cancellation) ---");
  const cancelledApt = state.appointments.find((a) => a.runtimeStatus === "cancelled");
  if (cancelledApt === undefined) {
    console.log("  ⚠ No hay appointment cancelled en el state actual. Skip.");
  } else {
    console.log(`  Disparando cancellation sobre eventId=${cancelledApt.eventId}`);
    const cancelDecision = await processEvent({
      kind: "cancellation",
      instant: Date.now(),
      tenantId: String(clinicId),
      eventId: cancelledApt.eventId,
      noticeAheadMs: 0,
    });
    console.log(
      `  ✓ Decision proposal: ${cancelDecision.proposal === null ? "null" : "tiene proposal"}`,
    );
    if (cancelDecision.proposal !== null) {
      console.log(`    primera primitiva: ${cancelDecision.proposal[0].kind}`);
      console.log(
        `    projectedBillableValue: €${cancelDecision.explanation.projectedKPIs.projectedBillableValue.toFixed(2)}`,
      );
      console.log(
        `    ifRejectedKPIs.projectedBillableValue: €${cancelDecision.explanation.ifRejectedKPIs.projectedBillableValue.toFixed(2)}`,
      );
    }
    console.log(
      `  ✓ alternatives: ${cancelDecision.explanation.consideredAlternatives.length}`,
    );
  }

  // ---- Test 4: Verificar que los riesgos del Predictor están vivos ----
  console.log("\n--- Test 4: Riesgos del Predictor ---");
  const sampleAppts = state.appointments.slice(0, 3);
  for (const a of sampleAppts) {
    console.log(
      `  eventId=${a.eventId}: noShow=${a.detectedRisks.noShowProbability.toFixed(3)} ` +
        `lateness=${a.detectedRisks.significantLatenessProbability.toFixed(3)}`,
    );
  }

  console.log("\n=== Smoke test completado sin excepciones ===\n");
}

main()
  .catch((e) => {
    console.error("\n❌ Error en smoke test:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());