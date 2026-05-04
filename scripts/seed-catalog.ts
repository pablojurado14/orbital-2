/**
 * Seed inicial del catálogo maestro (Sesión 11B).
 *
 * Crea:
 *  - 14 Procedure (catálogo global, sin clinicId — gestionado por la empresa).
 *    Códigos CDT (Code on Dental Procedures and Nomenclature, ADA).
 *  - 8 Equipment para la clínica actual (clinicId vía 1).
 *  - EquipmentRoom: mobile → todos los gabinetes activos; fixed_in_room → primer gabinete.
 *  - ProcedureActivation para todos los Procedure × clinicId actual, cold start (learned = reference).
 *
 * Idempotencia:
 *  - Procedure: upsert por (code, version). Re-ejecutar es seguro y refresca metadatos.
 *  - Equipment: si ya hay registros para esta clínica, se salta (evita duplicar).
 *  - ProcedureActivation: si ya hay registros para esta clínica, se salta.
 *
 * Distribuciones en MINUTOS. Cumplen invariante I-8 del contrato (mean > 0,
 * stdDev >= 0, p10 <= p50 <= p90), validado al inicio del main.
 *
 * Ejecutar: npx tsx --env-file=.env scripts/seed-catalog.ts
 */

import { prisma } from "../lib/prisma";
import { getCurrentClinicId } from "../lib/tenant";

// ============================================================
// Tipos JSON-safe (compatibles con Prisma InputJsonValue)
// ============================================================

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

// ============================================================
// Catálogo maestro de procedimientos dentales
// ============================================================

interface ProcedureSeed {
  code: string;
  name: string;
  category: string;
  subcategory: string | null;
  requiresProfessionalCapabilities: Record<string, boolean>;
  requiresRoomCapabilities: Record<string, boolean>;
  requiresEquipment: Array<{ type: string; durationMinutes: number }>;
  requiresAuxiliary: boolean;
  auxiliaryCapabilities: Record<string, boolean> | null;
  referenceDurationMean: number;
  referenceDurationStdDev: number;
  referenceDurationP10: number;
  referenceDurationP50: number;
  referenceDurationP90: number;
  clinicalDependencies: JsonObject | null;
}

const PROCEDURES: ProcedureSeed[] = [
  // --- Diagnostic ---
  {
    code: "D0150",
    name: "Examen oral comprehensivo (revisión inicial)",
    category: "diagnostic",
    subcategory: "examination",
    requiresProfessionalCapabilities: { general_dentistry: true },
    requiresRoomCapabilities: { standard_treatment_room: true },
    requiresEquipment: [],
    requiresAuxiliary: false,
    auxiliaryCapabilities: null,
    referenceDurationMean: 17,
    referenceDurationStdDev: 5,
    referenceDurationP10: 10,
    referenceDurationP50: 15,
    referenceDurationP90: 25,
    clinicalDependencies: null,
  },
  {
    code: "D9310",
    name: "Consulta de especialista",
    category: "diagnostic",
    subcategory: "consultation",
    requiresProfessionalCapabilities: { general_dentistry: true },
    requiresRoomCapabilities: { standard_treatment_room: true },
    requiresEquipment: [],
    requiresAuxiliary: false,
    auxiliaryCapabilities: null,
    referenceDurationMean: 25,
    referenceDurationStdDev: 7,
    referenceDurationP10: 15,
    referenceDurationP50: 25,
    referenceDurationP90: 35,
    clinicalDependencies: null,
  },
  {
    code: "D0470",
    name: "Toma de impresiones / modelos diagnósticos",
    category: "diagnostic",
    subcategory: "impressions",
    requiresProfessionalCapabilities: { general_dentistry: true, hygienist: true },
    requiresRoomCapabilities: { standard_treatment_room: true },
    requiresEquipment: [{ type: "intraoral_scanner", durationMinutes: 15 }],
    requiresAuxiliary: false,
    auxiliaryCapabilities: null,
    referenceDurationMean: 25,
    referenceDurationStdDev: 7,
    referenceDurationP10: 15,
    referenceDurationP50: 25,
    referenceDurationP90: 35,
    clinicalDependencies: null,
  },

  // --- Preventive ---
  {
    code: "D1110",
    name: "Profilaxis (limpieza dental adulto)",
    category: "preventive",
    subcategory: "prophylaxis",
    requiresProfessionalCapabilities: { hygienist: true },
    requiresRoomCapabilities: { hygiene_room: true, standard_treatment_room: true },
    requiresEquipment: [{ type: "ultrasonic_scaler", durationMinutes: 20 }],
    requiresAuxiliary: false,
    auxiliaryCapabilities: null,
    referenceDurationMean: 35,
    referenceDurationStdDev: 8,
    referenceDurationP10: 25,
    referenceDurationP50: 35,
    referenceDurationP90: 50,
    clinicalDependencies: null,
  },

  // --- Restorative ---
  {
    code: "D2391",
    name: "Empaste composite, una superficie (posterior)",
    category: "restorative",
    subcategory: "filling",
    requiresProfessionalCapabilities: { general_dentistry: true },
    requiresRoomCapabilities: { standard_treatment_room: true },
    requiresEquipment: [],
    requiresAuxiliary: true,
    auxiliaryCapabilities: { dental_assistant: true },
    referenceDurationMean: 35,
    referenceDurationStdDev: 10,
    referenceDurationP10: 25,
    referenceDurationP50: 35,
    referenceDurationP90: 50,
    clinicalDependencies: null,
  },
  {
    code: "D2740",
    name: "Corona cerámica (cementado)",
    category: "restorative",
    subcategory: "crown",
    requiresProfessionalCapabilities: { general_dentistry: true, prosthodontics: true },
    requiresRoomCapabilities: { standard_treatment_room: true },
    requiresEquipment: [],
    requiresAuxiliary: true,
    auxiliaryCapabilities: { dental_assistant: true },
    referenceDurationMean: 50,
    referenceDurationStdDev: 12,
    referenceDurationP10: 35,
    referenceDurationP50: 50,
    referenceDurationP90: 70,
    clinicalDependencies: { precondition: "tallado_previo_corona" },
  },

  // --- Endodontics ---
  {
    code: "D3310",
    name: "Endodoncia unirradicular",
    category: "endodontics",
    subcategory: "root_canal",
    requiresProfessionalCapabilities: { endodontics: true, general_dentistry: true },
    requiresRoomCapabilities: { standard_treatment_room: true },
    requiresEquipment: [{ type: "endodontic_motor", durationMinutes: 50 }],
    requiresAuxiliary: true,
    auxiliaryCapabilities: { dental_assistant: true },
    referenceDurationMean: 65,
    referenceDurationStdDev: 15,
    referenceDurationP10: 50,
    referenceDurationP50: 65,
    referenceDurationP90: 90,
    clinicalDependencies: null,
  },
  {
    code: "D3330",
    name: "Endodoncia molar (multirradicular)",
    category: "endodontics",
    subcategory: "root_canal",
    requiresProfessionalCapabilities: { endodontics: true },
    requiresRoomCapabilities: { standard_treatment_room: true },
    requiresEquipment: [{ type: "endodontic_motor", durationMinutes: 80 }],
    requiresAuxiliary: true,
    auxiliaryCapabilities: { dental_assistant: true },
    referenceDurationMean: 100,
    referenceDurationStdDev: 20,
    referenceDurationP10: 75,
    referenceDurationP50: 100,
    referenceDurationP90: 130,
    clinicalDependencies: null,
  },

  // --- Periodontics ---
  {
    code: "D4341",
    name: "Raspado y alisado radicular (por cuadrante)",
    category: "periodontics",
    subcategory: "scaling_root_planing",
    requiresProfessionalCapabilities: { periodontics: true, hygienist: true },
    requiresRoomCapabilities: { hygiene_room: true, standard_treatment_room: true },
    requiresEquipment: [{ type: "ultrasonic_scaler", durationMinutes: 40 }],
    requiresAuxiliary: false,
    auxiliaryCapabilities: null,
    referenceDurationMean: 50,
    referenceDurationStdDev: 12,
    referenceDurationP10: 35,
    referenceDurationP50: 50,
    referenceDurationP90: 70,
    clinicalDependencies: null,
  },

  // --- Oral Surgery ---
  {
    code: "D7140",
    name: "Extracción simple",
    category: "oral_surgery",
    subcategory: "extraction",
    requiresProfessionalCapabilities: { general_dentistry: true, oral_surgery: true },
    requiresRoomCapabilities: { standard_treatment_room: true },
    requiresEquipment: [],
    requiresAuxiliary: true,
    auxiliaryCapabilities: { dental_assistant: true },
    referenceDurationMean: 25,
    referenceDurationStdDev: 8,
    referenceDurationP10: 15,
    referenceDurationP50: 25,
    referenceDurationP90: 40,
    clinicalDependencies: null,
  },
  {
    code: "D7240",
    name: "Extracción quirúrgica de cordal",
    category: "oral_surgery",
    subcategory: "extraction",
    requiresProfessionalCapabilities: { oral_surgery: true },
    requiresRoomCapabilities: { surgery_room: true, standard_treatment_room: true },
    requiresEquipment: [],
    requiresAuxiliary: true,
    auxiliaryCapabilities: { dental_assistant: true },
    referenceDurationMean: 50,
    referenceDurationStdDev: 15,
    referenceDurationP10: 30,
    referenceDurationP50: 50,
    referenceDurationP90: 75,
    clinicalDependencies: null,
  },

  // --- Implantology ---
  {
    code: "D6010",
    name: "Implante endóseo (fase quirúrgica)",
    category: "implantology",
    subcategory: "implant_surgical",
    requiresProfessionalCapabilities: { implantology: true, oral_surgery: true },
    requiresRoomCapabilities: { surgery_room: true },
    requiresEquipment: [{ type: "implant_surgical_kit", durationMinutes: 60 }],
    requiresAuxiliary: true,
    auxiliaryCapabilities: { dental_assistant: true },
    referenceDurationMean: 75,
    referenceDurationStdDev: 20,
    referenceDurationP10: 50,
    referenceDurationP50: 75,
    referenceDurationP90: 105,
    clinicalDependencies: { post_procedure_interval_days: 90, post_procedure: "implant_prosthetic" },
  },

  // --- Cosmetic ---
  {
    code: "D9972",
    name: "Blanqueamiento dental in-office",
    category: "cosmetic",
    subcategory: "whitening",
    requiresProfessionalCapabilities: { cosmetic_dentistry: true, general_dentistry: true },
    requiresRoomCapabilities: { standard_treatment_room: true },
    requiresEquipment: [{ type: "whitening_lamp", durationMinutes: 50 }],
    requiresAuxiliary: false,
    auxiliaryCapabilities: null,
    referenceDurationMean: 65,
    referenceDurationStdDev: 15,
    referenceDurationP10: 50,
    referenceDurationP50: 65,
    referenceDurationP90: 85,
    clinicalDependencies: null,
  },

  // --- Orthodontics ---
  {
    code: "D8670",
    name: "Visita periódica de ortodoncia",
    category: "orthodontics",
    subcategory: "follow_up",
    requiresProfessionalCapabilities: { orthodontics: true },
    requiresRoomCapabilities: { standard_treatment_room: true },
    requiresEquipment: [],
    requiresAuxiliary: false,
    auxiliaryCapabilities: null,
    referenceDurationMean: 20,
    referenceDurationStdDev: 6,
    referenceDurationP10: 12,
    referenceDurationP50: 20,
    referenceDurationP90: 30,
    clinicalDependencies: null,
  },
];

// ============================================================
// Catálogo de equipamiento típico
// ============================================================

interface EquipmentSeed {
  type: string;
  name: string;
  modality: "fixed_in_room" | "mobile";
  setupTimeMs: number | null;
  cleanupTimeMs: number | null;
  sterilizationCycleMs: number | null;
}

const EQUIPMENT: EquipmentSeed[] = [
  {
    type: "intraoral_scanner",
    name: "Escáner intraoral",
    modality: "mobile",
    setupTimeMs: 2 * 60 * 1000,
    cleanupTimeMs: 3 * 60 * 1000,
    sterilizationCycleMs: null,
  },
  {
    type: "panoramic_xray",
    name: "RX panorámica",
    modality: "fixed_in_room",
    setupTimeMs: 1 * 60 * 1000,
    cleanupTimeMs: 1 * 60 * 1000,
    sterilizationCycleMs: null,
  },
  {
    type: "intraoral_xray",
    name: "RX intraoral portátil",
    modality: "mobile",
    setupTimeMs: 1 * 60 * 1000,
    cleanupTimeMs: 1 * 60 * 1000,
    sterilizationCycleMs: null,
  },
  {
    type: "sterilizer_autoclave",
    name: "Autoclave esterilizador",
    modality: "fixed_in_room",
    setupTimeMs: 2 * 60 * 1000,
    cleanupTimeMs: 2 * 60 * 1000,
    sterilizationCycleMs: 30 * 60 * 1000,
  },
  {
    type: "endodontic_motor",
    name: "Motor de endodoncia",
    modality: "mobile",
    setupTimeMs: 3 * 60 * 1000,
    cleanupTimeMs: 4 * 60 * 1000,
    sterilizationCycleMs: 30 * 60 * 1000,
  },
  {
    type: "implant_surgical_kit",
    name: "Kit quirúrgico de implantes",
    modality: "mobile",
    setupTimeMs: 5 * 60 * 1000,
    cleanupTimeMs: 5 * 60 * 1000,
    sterilizationCycleMs: 45 * 60 * 1000,
  },
  {
    type: "whitening_lamp",
    name: "Lámpara de blanqueamiento LED",
    modality: "mobile",
    setupTimeMs: 2 * 60 * 1000,
    cleanupTimeMs: 2 * 60 * 1000,
    sterilizationCycleMs: null,
  },
  {
    type: "ultrasonic_scaler",
    name: "Ultrasonidos / scaler",
    modality: "mobile",
    setupTimeMs: 1 * 60 * 1000,
    cleanupTimeMs: 2 * 60 * 1000,
    sterilizationCycleMs: 30 * 60 * 1000,
  },
];

// ============================================================
// Validación de invariantes (I-8 del contrato del core)
// ============================================================

function validateProcedureDistributions(procedures: ProcedureSeed[]): void {
  for (const p of procedures) {
    if (p.referenceDurationMean <= 0) {
      throw new Error(`I-8 violado en ${p.code}: mean (${p.referenceDurationMean}) debe ser > 0`);
    }
    if (p.referenceDurationStdDev < 0) {
      throw new Error(`I-8 violado en ${p.code}: stdDev (${p.referenceDurationStdDev}) debe ser >= 0`);
    }
    if (
      !(
        p.referenceDurationP10 <= p.referenceDurationP50 &&
        p.referenceDurationP50 <= p.referenceDurationP90
      )
    ) {
      throw new Error(
        `I-8 violado en ${p.code}: debe cumplirse p10 <= p50 <= p90 (got ${p.referenceDurationP10}, ${p.referenceDurationP50}, ${p.referenceDurationP90})`
      );
    }
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  const clinicId = 1;
  console.log(`\n🌱 Seed catálogo maestro — clinicId=${clinicId}\n`);

  validateProcedureDistributions(PROCEDURES);
  console.log(`✓ Invariante I-8 validado en ${PROCEDURES.length} procedimientos\n`);

  // ---- Procedure (global, upsert idempotente) ----
  console.log("📋 Procedimientos del catálogo maestro (global)...");
  let procedureCreated = 0;
  let procedureUpdated = 0;
  for (const p of PROCEDURES) {
    const existing = await prisma.procedure.findUnique({
      where: { code_version: { code: p.code, version: 1 } },
    });
    await prisma.procedure.upsert({
      where: { code_version: { code: p.code, version: 1 } },
      create: {
        code: p.code,
        name: p.name,
        category: p.category,
        subcategory: p.subcategory,
        requiresProfessionalCapabilities: p.requiresProfessionalCapabilities,
        requiresRoomCapabilities: p.requiresRoomCapabilities,
        requiresEquipment: p.requiresEquipment,
        requiresAuxiliary: p.requiresAuxiliary,
        auxiliaryCapabilities: p.auxiliaryCapabilities ?? undefined,
        referenceDurationMean: p.referenceDurationMean,
        referenceDurationStdDev: p.referenceDurationStdDev,
        referenceDurationP10: p.referenceDurationP10,
        referenceDurationP50: p.referenceDurationP50,
        referenceDurationP90: p.referenceDurationP90,
        clinicalDependencies: p.clinicalDependencies ?? undefined,
        version: 1,
        active: true,
      },
      update: {
        name: p.name,
        category: p.category,
        subcategory: p.subcategory,
        requiresProfessionalCapabilities: p.requiresProfessionalCapabilities,
        requiresRoomCapabilities: p.requiresRoomCapabilities,
        requiresEquipment: p.requiresEquipment,
        requiresAuxiliary: p.requiresAuxiliary,
        auxiliaryCapabilities: p.auxiliaryCapabilities ?? undefined,
        referenceDurationMean: p.referenceDurationMean,
        referenceDurationStdDev: p.referenceDurationStdDev,
        referenceDurationP10: p.referenceDurationP10,
        referenceDurationP50: p.referenceDurationP50,
        referenceDurationP90: p.referenceDurationP90,
        clinicalDependencies: p.clinicalDependencies ?? undefined,
      },
    });
    if (existing) procedureUpdated++;
    else procedureCreated++;
  }
  console.log(
    `   ✓ ${procedureCreated} creados, ${procedureUpdated} actualizados (de ${PROCEDURES.length} total)\n`
  );

  // ---- Equipment + EquipmentRoom (por clínica, idempotente con skip) ----
  console.log("🔧 Equipamiento de la clínica...");
  const existingEquipmentCount = await prisma.equipment.count({ where: { clinicId } });
  if (existingEquipmentCount > 0) {
    console.log(
      `   ⊘ Ya existen ${existingEquipmentCount} equipos para clinicId=${clinicId}. Skip.\n`
    );
  } else {
    const gabinetes = await prisma.gabinete.findMany({
      where: { clinicId, active: true },
      orderBy: { id: "asc" },
    });
    if (gabinetes.length === 0) {
      throw new Error(
        `No hay gabinetes activos para clinicId=${clinicId}. Seed los gabinetes primero.`
      );
    }
    console.log(`   → ${gabinetes.length} gabinetes activos encontrados`);

    let equipmentCreated = 0;
    let equipmentRoomCreated = 0;
    for (const eq of EQUIPMENT) {
      const equipment = await prisma.equipment.create({
        data: {
          clinicId,
          type: eq.type,
          name: eq.name,
          modality: eq.modality,
          setupTimeMs: eq.setupTimeMs,
          cleanupTimeMs: eq.cleanupTimeMs,
          sterilizationCycleMs: eq.sterilizationCycleMs,
          active: true,
        },
      });
      equipmentCreated++;

      // Asignación de salas:
      //  - mobile: compatible con todos los gabinetes activos
      //  - fixed_in_room: solo el primer gabinete (asunción por defecto, ajustable manualmente)
      const targetGabinetes = eq.modality === "mobile" ? gabinetes : [gabinetes[0]];
      for (const gab of targetGabinetes) {
        await prisma.equipmentRoom.create({
          data: { equipmentId: equipment.id, gabineteId: gab.id },
        });
        equipmentRoomCreated++;
      }
    }
    console.log(
      `   ✓ ${equipmentCreated} equipos creados, ${equipmentRoomCreated} relaciones EquipmentRoom\n`
    );
  }

  // ---- ProcedureActivation (por clínica, idempotente con skip) ----
  console.log("✅ Activaciones de procedimientos para la clínica (cold start)...");
  const existingActivationsCount = await prisma.procedureActivation.count({
    where: { clinicId },
  });
  if (existingActivationsCount > 0) {
    console.log(
      `   ⊘ Ya existen ${existingActivationsCount} activaciones para clinicId=${clinicId}. Skip.\n`
    );
  } else {
    const allProcedures = await prisma.procedure.findMany({ where: { active: true } });
    let activationsCreated = 0;
    for (const proc of allProcedures) {
      await prisma.procedureActivation.create({
        data: {
          clinicId,
          procedureId: proc.id,
          active: true,
          // Cold start: learned = reference (se ajustará con datos reales)
          learnedDurationMean: proc.referenceDurationMean,
          learnedDurationStdDev: proc.referenceDurationStdDev,
          learnedDurationP10: proc.referenceDurationP10,
          learnedDurationP50: proc.referenceDurationP50,
          learnedDurationP90: proc.referenceDurationP90,
          currency: "EUR",
        },
      });
      activationsCreated++;
    }
    console.log(
      `   ✓ ${activationsCreated} activaciones creadas (cold start: learned = reference)\n`
    );
  }

  console.log("✨ Seed catálogo completado.\n");
}

main()
  .catch((e) => {
    console.error("❌ Error en seed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());