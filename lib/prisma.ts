import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaAdmin: PrismaClient | undefined;
};

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no esta definido en .env");
}

// Connection string para la app (app_role no-owner en branch dev).
// Fallback a DATABASE_URL si no esta definida (backward-compat para
// produccion mientras no se haya migrado a app_role separado).
const APP_DB_URL = process.env.DATABASE_URL_APP ?? process.env.DATABASE_URL;

// Adapter para la app: usa app_role. Las queries se filtran por RLS
// Postgres cuando se ejecutan dentro de withClinic (lib/tenant-prisma.ts).
const appAdapter = new PrismaPg({
  connectionString: APP_DB_URL,
});

// Adapter admin: usa neondb_owner (DATABASE_URL). Bypassea RLS por ser
// owner de las tablas. Solo para scripts standalone (seed, catalog,
// rewind) y bootstrap (ensureClinicExists en route.ts).
const adminAdapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: appAdapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

export const prismaAdmin =
  globalForPrisma.prismaAdmin ??
  new PrismaClient({
    adapter: adminAdapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaAdmin = prismaAdmin;
}