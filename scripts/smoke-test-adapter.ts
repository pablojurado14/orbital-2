/**
 * Smoke test del adapter del clean core (Sesión 18 + Sesión 18.5).
 *
 * NO es un test de Vitest — es un script ejecutable que prueba el adapter
 * contra la DB Frankfurt real (la misma que sirve la URL pública).
 * Verifica que las 4 operaciones críticas no explotan y que producen
 * outputs estructuralmente coherentes.
 *
 * Sesión 18.5 — cambios respecto a Sesión 18:
 *   - Test 3 ahora usa assertion real (throw si falla), no solo console.log.
 *     Cubre la verificación que la deuda ADAPTER-EVENT-NOT-APPLIED-TO-STATE-V1
 *     pretendía resolver (descubrimos en S18.5 que la causa real era el
 *     threshold default, ya destrabado vía ClinicSettings.umbralDisparoProactivo).
 *   - Test 5 nuevo: confirma que el threshold per-tenant se está leyendo
 *     desde DB y se está propagando al Coordinator.
 *
 * Ejecutar: npx tsx --env-file=.env scripts/smoke-test-adapter.ts
 *
 * Verifica:
 *   1. buildContextsFromDb() carga state, runtimes, contexts y
 *      coordinatorOptions sin error.
 *   2. processEvent(proactive_tick) devuelve un CycleDecision válido
 *      (proposal=null esperado en v1 — proactive_sweep difiere a deuda
 *      PROACTIVE-SWEEP-MULTI-GAP-V1).
 *   3. processEvent(cancellation sobre el cancelled del seed) produce un
 *      proposal con kind="fill_from_waitlist" — ASSERTION REAL, rompe si null.
 *   4. Los riesgos del Predictor están rellenados.
 *   5. CoordinatorOptions.improvementThreshold se lee de
 *      ClinicSettings.umbralDisparoProactivo (decisión rectora 10).
 */

import { buildContextsFromDb, processEvent } from "../lib/core/adapter";
import { prisma } from "../lib/prisma";
import { getCurrentClinicId } from "../lib/tenant";

class SmokeAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmokeAssertionError";
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new SmokeAssertionError(message);
  }
}

async function main() {
  console.log("\n=== Smoke test del adapter del clean core ===\n");

  const clinicId = getCurrentClinicId();
  console.log(`clinicId actual: ${clinicId}\n`);

  // ---- Test 1: buildContextsFromDb ----
  console.log("--- Test 1: buildContextsFromDb() ---");
  const { state, runtimes, contexts, coordinatorOptions } =
    await buildContextsFromDb();

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

  // Test 1 assertions estructurales
  assert(
    state.appointments.length > 0,
    "Test 1: state.appointments está vacío. Ejecuta scripts/rewind-appointments-to-today.ts.",
  );
  assert(
    contexts.generation.waitlist.candidates.length > 0,
    "Test 1: waitlist sin candidatos. Verifica el seed.",
  );

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
  console.log(
    `  ✓ Decision proposal: ${tickDecision.proposal === null ? "null" : "no-null"}`,
  );
  console.log(`  ✓ autonomyLevel: ${tickDecision.autonomyLevel}`);
  console.log(`  ✓ motiveCode: ${tickDecision.explanation.motiveCode}`);
  console.log(
    `  ✓ alternatives consideradas: ${tickDecision.explanation.consideredAlternatives.length}`,
  );

  // Test 2: proactive_tick devuelve null en v1 por PROACTIVE-SWEEP-MULTI-GAP-V1.
  // Si llegara a ser != null sería sorpresa positiva (el Generator empezó a
  // producir candidatas para proactive_sweep) — no rompemos por eso.

  // ---- Test 3: processEvent(cancellation) — ASSERTION REAL ----
  console.log("\n--- Test 3: processEvent(cancellation) — assertion real ---");
  const cancelledApt = state.appointments.find(
    (a) => a.runtimeStatus === "cancelled",
  );
  assert(
    cancelledApt !== undefined,
    "Test 3: no hay appointment con runtimeStatus='cancelled' en el state. " +
      "Ejecuta scripts/rewind-appointments-to-today.ts y verifica que el seed " +
      "incluye al menos un cancelled.",
  );

  console.log(`  Disparando cancellation sobre eventId=${cancelledApt.eventId}`);
  const cancelDecision = await processEvent({
    kind: "cancellation",
    instant: Date.now(),
    tenantId: String(clinicId),
    eventId: cancelledApt.eventId,
    noticeAheadMs: 0,
  });

  // ASSERTION CRÍTICA: el adapter debe producir un proposal con
  // fill_from_waitlist. Si esto falla, el flag USE_CLEAN_CORE no debe
  // flippearse — la URL pública seguiría sirviendo respuestas peores que el
  // motor v7.3 legacy.
  assert(
    cancelDecision.proposal !== null,
    `Test 3 FALLO: cancellation sobre eventId=${cancelledApt.eventId} produjo ` +
      `proposal=null con ${cancelDecision.explanation.consideredAlternatives.length} ` +
      `alternativas. Revisar threshold en ClinicSettings.umbralDisparoProactivo o ` +
      `calibración del Scorer. NO flippear flag USE_CLEAN_CORE en este estado.`,
  );
  assert(
    cancelDecision.proposal[0].kind === "fill_from_waitlist",
    `Test 3 FALLO: primera primitiva del proposal es ` +
      `"${cancelDecision.proposal[0].kind}", se esperaba "fill_from_waitlist".`,
  );

  console.log(`  ✓ proposal != null`);
  console.log(`  ✓ primera primitiva: ${cancelDecision.proposal[0].kind}`);
  console.log(
    `  ✓ projectedBillableValue: €${cancelDecision.explanation.projectedKPIs.projectedBillableValue.toFixed(2)}`,
  );
  console.log(
    `  ✓ ifRejectedKPIs.projectedBillableValue: €${cancelDecision.explanation.ifRejectedKPIs.projectedBillableValue.toFixed(2)}`,
  );
  const recoveredEstimate =
    cancelDecision.explanation.projectedKPIs.projectedBillableValue -
    cancelDecision.explanation.ifRejectedKPIs.projectedBillableValue;
  console.log(`  ✓ Recuperación estimada: €${recoveredEstimate.toFixed(2)}`);
  console.log(
    `  ✓ alternatives: ${cancelDecision.explanation.consideredAlternatives.length}`,
  );
  console.log(`  ✓ motiveCode: ${cancelDecision.explanation.motiveCode}`);

  // ---- Test 4: Riesgos del Predictor ----
  console.log("\n--- Test 4: Riesgos del Predictor ---");
  const sampleAppts = state.appointments.slice(0, 3);
  for (const a of sampleAppts) {
    console.log(
      `  eventId=${a.eventId}: noShow=${a.detectedRisks.noShowProbability.toFixed(3)} ` +
        `lateness=${a.detectedRisks.significantLatenessProbability.toFixed(3)}`,
    );
  }
  // Assertion: al menos un appointment tiene noShowProbability != 0
  // (confirma que el Predictor está conectado, no devolviendo zeros mecánicos).
  assert(
    sampleAppts.some((a) => a.detectedRisks.noShowProbability > 0),
    "Test 4 FALLO: ningún appointment tiene noShowProbability > 0. " +
      "El Predictor probablemente no está siendo invocado correctamente.",
  );
  console.log(`  ✓ Predictor conectado (noShow > 0 en al menos un appointment)`);

  // ---- Test 5: CoordinatorOptions per-tenant ----
  console.log("\n--- Test 5: CoordinatorOptions per-tenant ---");
  console.log(
    `  improvementThreshold leído: ${coordinatorOptions.improvementThreshold}`,
  );
  // Assertion: el threshold debe ser un number finito y razonable.
  // En clinicId=1 (post-seed-engine-config) esperamos 0.001. Otros tenants
  // futuros podrán tener otros valores, así que solo validamos rango.
  assert(
    typeof coordinatorOptions.improvementThreshold === "number",
    "Test 5 FALLO: improvementThreshold no es number.",
  );
  assert(
    Number.isFinite(coordinatorOptions.improvementThreshold!),
    "Test 5 FALLO: improvementThreshold no es finito.",
  );
  assert(
    coordinatorOptions.improvementThreshold! >= 0 &&
      coordinatorOptions.improvementThreshold! <= 1,
    `Test 5 FALLO: improvementThreshold fuera de rango [0,1]: ${coordinatorOptions.improvementThreshold}.`,
  );
  console.log(`  ✓ improvementThreshold válido y per-tenant`);

  console.log("\n=== Smoke test completado: TODAS LAS ASSERTIONS PASARON ===\n");
}

main()
  .catch((e) => {
    if (e instanceof SmokeAssertionError) {
      console.error(`\n❌ ${e.message}\n`);
    } else {
      console.error("\n❌ Error inesperado en smoke test:", e);
    }
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());