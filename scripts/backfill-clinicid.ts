import { prisma } from "../lib/prisma";

async function main() {
  console.log("🔧 Backfill: asignando clinicId=1 a todas las filas existentes...\n");

  const r1 = await prisma.gabinete.updateMany({
    where: { clinicId: null },
    data: { clinicId: 1 },
  });
  console.log(`  Gabinete: ${r1.count} filas actualizadas`);

  const r2 = await prisma.dentist.updateMany({
    where: { clinicId: null },
    data: { clinicId: 1 },
  });
  console.log(`  Dentist: ${r2.count} filas actualizadas`);

  const r3 = await prisma.treatmentType.updateMany({
    where: { clinicId: null },
    data: { clinicId: 1 },
  });
  console.log(`  TreatmentType: ${r3.count} filas actualizadas`);

  const r4 = await prisma.patient.updateMany({
    where: { clinicId: null },
    data: { clinicId: 1 },
  });
  console.log(`  Patient: ${r4.count} filas actualizadas`);

  const r5 = await prisma.appointment.updateMany({
    where: { clinicId: null },
    data: { clinicId: 1 },
  });
  console.log(`  Appointment: ${r5.count} filas actualizadas`);

  const r6 = await prisma.runtimeState.updateMany({
    where: { clinicId: null },
    data: { clinicId: 1 },
  });
  console.log(`  RuntimeState: ${r6.count} filas actualizadas`);

  console.log("\n✅ Backfill completado.");
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());