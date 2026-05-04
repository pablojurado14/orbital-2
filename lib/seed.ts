import { prisma } from "./prisma";
import bcrypt from "bcryptjs";

export async function seed() {
  // 1. Clínica única (id=1) — base del tenant
  const clinic = await prisma.clinicSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: "Mi Clínica Dental" },
  });
  const clinicId = clinic.id;

  // 2. Horarios semanales
  const dayDefaults = [
    { dayOfWeek: 1, isOpen: true,  morningOpen: "09:00", morningClose: "13:30", afternoonOpen: "16:00", afternoonClose: "20:00" },
    { dayOfWeek: 2, isOpen: true,  morningOpen: "09:00", morningClose: "13:30", afternoonOpen: "16:00", afternoonClose: "20:00" },
    { dayOfWeek: 3, isOpen: true,  morningOpen: "09:00", morningClose: "13:30", afternoonOpen: "16:00", afternoonClose: "20:00" },
    { dayOfWeek: 4, isOpen: true,  morningOpen: "09:00", morningClose: "13:30", afternoonOpen: "16:00", afternoonClose: "20:00" },
    { dayOfWeek: 5, isOpen: true,  morningOpen: "09:00", morningClose: "14:00" },
    { dayOfWeek: 6, isOpen: false },
    { dayOfWeek: 0, isOpen: false },
  ];
  for (const s of dayDefaults) {
    await prisma.daySchedule.upsert({
      where: { clinicId_dayOfWeek: { clinicId, dayOfWeek: s.dayOfWeek } },
      update: {},
      create: { clinicId, ...s },
    });
  }

  // 3. Gabinetes
  const [gab1, gab2, gab3, gab4] = await Promise.all([
    prisma.gabinete.create({ data: { name: "Gab. 1", clinicId } }),
    prisma.gabinete.create({ data: { name: "Gab. 2", clinicId } }),
    prisma.gabinete.create({ data: { name: "Gab. 3", clinicId } }),
    prisma.gabinete.create({ data: { name: "Gab. 4", clinicId } }),
  ]);

  // 4. Dentistas
  const [drGarcia, drRuiz, drMendez] = await Promise.all([
    prisma.dentist.create({ data: { name: "Dra. García", specialty: "Odontología general", clinicId } }),
    prisma.dentist.create({ data: { name: "Dr. Ruiz",    specialty: "Endodoncia",          clinicId } }),
    prisma.dentist.create({ data: { name: "Dra. Méndez", specialty: "Implantología",       clinicId } }),
  ]);

  // 5. Tratamientos
  const [revision, empaste, implanteRev, limpieza, endodonciaUnirradicular, implante, empasteX3] = await Promise.all([
    prisma.treatmentType.create({ data: { name: "Revisión",      duration: 30, price: 45,  clinicId } }),
    prisma.treatmentType.create({ data: { name: "Empaste",       duration: 60, price: 120, clinicId } }),
    prisma.treatmentType.create({ data: { name: "Revisión de implante", duration: 60, price: 160, clinicId } }),
    prisma.treatmentType.create({ data: { name: "Limpieza",      duration: 60, price: 70,  clinicId } }),
    prisma.treatmentType.create({ data: { name: "Endodoncia unirradicular",    duration: 60, price: 180, clinicId } }),
    prisma.treatmentType.create({ data: { name: "Implante",      duration: 90, price: 400, clinicId } }),
    prisma.treatmentType.create({ data: { name: "Empaste x3",    duration: 60, price: 150, clinicId } }),
  ]);

  // 6. Pacientes (sin lista de espera)
  const [ana, carlos, isabel, laura, david] = await Promise.all([
    prisma.patient.create({ data: { name: "Ana R.",    clinicId } }),
    prisma.patient.create({ data: { name: "Carlos M.", clinicId } }),
    prisma.patient.create({ data: { name: "Isabel V.", clinicId } }),
    prisma.patient.create({ data: { name: "Laura P.",  clinicId } }),
    prisma.patient.create({ data: { name: "David Q.",  clinicId } }),
  ]);

  // 7. Pacientes en lista de espera (S19.B)
  const [monica, luis, jorge, pilar] = await Promise.all([
    prisma.patient.create({
      data: { name: "Mónica T.", clinicId, preferredGabineteId: gab4.id },
    }),
    prisma.patient.create({
      data: { name: "Luis F.", clinicId, preferredGabineteId: gab2.id },
    }),
    prisma.patient.create({
      data: { name: "Jorge V.", clinicId },
    }),
    prisma.patient.create({
      data: { name: "Pilar R.", clinicId, preferredGabineteId: gab4.id },
    }),
  ]);

  await Promise.all([
    prisma.waitlistEntry.create({
      data: {
        clinicId, patientId: monica.id, desiredTreatmentTypeId: endodonciaUnirradicular.id,
        durationSlots: 2, value: 180, priority: 4, availableNow: true, easeScore: 5,
      },
    }),
    prisma.waitlistEntry.create({
      data: {
        clinicId, patientId: luis.id, desiredTreatmentTypeId: implante.id,
        durationSlots: 3, value: 400, priority: 5, availableNow: false, easeScore: 2,
      },
    }),
    prisma.waitlistEntry.create({
      data: {
        clinicId, patientId: jorge.id, desiredTreatmentTypeId: limpieza.id,
        durationSlots: 1, value: 60, priority: 3, availableNow: true, easeScore: 5,
      },
    }),
    prisma.waitlistEntry.create({
      data: {
        clinicId, patientId: pilar.id, desiredTreatmentTypeId: revision.id,
        durationSlots: 2, value: 90, priority: 2, availableNow: true, easeScore: 4,
      },
    }),
  ]);

  // 8. Citas de hoy
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  await Promise.all([
    prisma.appointment.create({ data: { clinicId, date: today, startTime: "09:00", duration: 30, status: "confirmed", value: 45,  gabineteId: gab1.id, patientId: ana.id,    dentistId: drGarcia.id, treatmentTypeId: revision.id } }),
    prisma.appointment.create({ data: { clinicId, date: today, startTime: "09:30", duration: 60, status: "confirmed", value: 120, gabineteId: gab1.id, patientId: carlos.id, dentistId: drGarcia.id, treatmentTypeId: empaste.id } }),
    prisma.appointment.create({ data: { clinicId, date: today, startTime: "10:00", duration: 60, status: "confirmed", value: 160, gabineteId: gab2.id, patientId: isabel.id, dentistId: drMendez.id, treatmentTypeId: implanteRev.id } }),
    prisma.appointment.create({ data: { clinicId, date: today, startTime: "11:00", duration: 60, status: "delayed",   value: 70,  gabineteId: gab3.id, patientId: laura.id,  dentistId: drRuiz.id,   treatmentTypeId: limpieza.id } }),
    prisma.appointment.create({ data: { clinicId, date: today, startTime: "10:30", duration: 60, status: "cancelled", value: 150, gabineteId: gab4.id, patientId: david.id,  dentistId: drGarcia.id, treatmentTypeId: empasteX3.id } }),
  ]);

  // 9. Usuario admin (S19.5)
  const adminEmail = "pablo7urado@gmail.com";
  const adminPasswordPlain = "orbital2026!";
  const passwordHash = await bcrypt.hash(adminPasswordPlain, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash,
      name: "Pablo Jurado",
      role: "admin",
      clinicId,
    },
  });

  console.log("✅ Seed completado.");
  console.log(`   Admin: ${adminEmail} / ${adminPasswordPlain}`);
}