import { prisma } from "@/lib/prisma";
import DentistasClient from "./DentistasClient";

export default async function DentistasPage() {
  const dentistas = await prisma.dentist.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <DentistasClient initialDentistas={dentistas} />
    </div>
  );
}
