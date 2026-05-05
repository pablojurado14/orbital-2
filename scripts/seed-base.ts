/**
 * Seed base - invoca lib/seed.ts (clinica, horarios, gabinetes, dentists,
 * treatments, patients, waitlist, appointments, admin user).
 *
 * Ejecutar: npx tsx --env-file=.env scripts/seed-base.ts
 */

import { prisma } from "../lib/prisma";
import { seed } from "../lib/seed";

seed()
  .catch((e) => {
    console.error("Error en seed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());