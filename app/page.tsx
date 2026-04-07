import { prisma } from "@/lib/prisma";

export default async function Home() {
  const clinics = await prisma.clinic.findMany();

  return (
    <div style={{ padding: "40px" }}>
      <h1>Clínicas</h1>
      {clinics.map((clinic) => (
        <div key={clinic.id}>{clinic.name}</div>
      ))}
    </div>
  );
}
