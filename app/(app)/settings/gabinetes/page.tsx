import { prisma } from "@/lib/prisma";
import { getCurrentClinicId } from "@/lib/tenant";
import GabinetesClient from "./GabinetesClient";

export const dynamic = "force-dynamic";

export default async function GabinetesPage() {
  const gabinetes = await prisma.gabinete.findMany({
    where: { clinicId: getCurrentClinicId() },
    orderBy: { name: "asc" },
  });
  return <GabinetesClient initialGabinetes={gabinetes} />;
}