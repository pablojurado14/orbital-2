import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const clinic = await prisma.clinic.create({
    data: {
      name: "Mi primera clínica",
    },
  });

  const user = await prisma.user.create({
    data: {
      email: "admin@orbital.com",
      name: "Admin",
      clinicId: clinic.id,
    },
  });

  console.log("Clinic:", clinic);
  console.log("User:", user);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
