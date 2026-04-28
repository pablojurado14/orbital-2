import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import TratamientosClient from "./TratamientosClient";

export const dynamic = "force-dynamic";

export default async function TratamientosPage() {
  const tratamientos = await prisma.treatmentType.findMany({
    where: { clinicId: getCurrentClinicId() },
    orderBy: { name: "asc" },
  });
  return <TratamientosClient initialTratamientos={tratamientos} />;
}