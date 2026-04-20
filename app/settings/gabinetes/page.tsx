import { prisma } from "@/lib/prisma";
import GabinetesClient from "./GabinetesClient";

export default async function GabinetesPage() {
  const gabinetes = await prisma.gabinete.findMany({
    orderBy: { name: "asc" },
  });

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <GabinetesClient initialGabinetes={gabinetes} />
    </div>
  );
}
