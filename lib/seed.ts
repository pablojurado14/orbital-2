import { prisma } from "./prisma";

export async function seedDemoData() {
  // 1. Clínica
  const clinic = await prisma.clinicSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: "Clínica Demo",
    },
  });

  // 2. Horarios semanales (L-V jornada partida, sábado solo mañana, domingo cerrado)
  const schedules = [
    { dayOfWeek: 1, isOpen: true,  morningOpen: "09:00", morningClose: "14:00", afternoonOpen: "16:00", afternoonClose: "20:00" },
    { dayOfWeek: 2, isOpen: true,  morningOpen: "09:00", morningClose: "14:00", afternoonOpen: "16:00", afternoonClose: "20:00" },
    { dayOfWeek: 3, isOpen: true,  morningOpen: "09:00", morningClose: "14:00", afternoonOpen: "16:00", afternoonClose: "20:00" },
    { dayOfWeek: 4, isOpen: true,  morningOpen: "09:00", morningClose: "14:00", afternoonOpen: "16:00", afternoonClose: "20:00" },
    { dayOfWeek: 5, isOpen: true,  morningOpen: "09:00", morningClose: "14:00", afternoonOpen: "16:00", afternoonClose: "20:00" },
    { dayOfWeek: 6, isOpen: true,  morningOpen: "09:00", morningClose: "14:00", afternoonOpen: null,    afternoonClose: null    },
    { dayOfWeek: 0, isOpen: false, morningOpen: null,    morningClose: null,    afternoonOpen: null,    afternoonClose: null    },
  ];
  for (const s of schedules) {
    await prisma.daySchedule.create({ data: { clinicId: clinic.id, ...s } });
  }

  // 3. Gabinetes
  const [gab1, gab2, gab3, gab4] = await Promise.all([
    prisma.gabinete.create({ data: { name: "Gab. 1" } }),
    prisma.gabinete.create({ data: { name: "Gab. 2" } }),
    prisma.gabinete.create({ data: { name: "Gab. 3" } }),
    prisma.gabinete.create({ data: { name: "Gab. 4" } }),
  ]);

  // 4. Dentistas
  const [drGarcia, drRuiz, drMendez] = await Promise.all([
    prisma.dentist.create({ data: { name: "Dra. García", specialty: "Odontología general" } }),
    prisma.dentist.create({ data: { name: "Dr. Ruiz",    specialty: "Endodoncia" } }),
    prisma.dentist.create({ data: { name: "Dra. Méndez", specialty: "Implantología" } }),
  ]);

  // 5. Tipos de tratamiento (duration en MINUTOS; 1 slot = 30 min)
  const [revision, empaste, implanteRev, limpieza, endodoncia, implante, empasteX3] = await Promise.all([
    prisma.treatmentType.create({ data: { name: "Revisión",      duration: 30, price: 45  } }),
    prisma.treatmentType.create({ data: { name: "Empaste",       duration: 60, price: 120 } }),
    prisma.treatmentType.create({ data: { name: "Implante rev.", duration: 60, price: 160 } }),
    prisma.treatmentType.create({ data: { name: "Limpieza",      duration: 60, price: 70  } }),
    prisma.treatmentType.create({ data: { name: "Endodoncia",    duration: 60, price: 180 } }),
    prisma.treatmentType.create({ data: { name: "Implante",      duration: 90, price: 400 } }),
    prisma.treatmentType.create({ data: { name: "Empaste x3",    duration: 60, price: 150 } }),
  ]);

  // 6. Pacientes con citas hoy
  const [ana, carlos, isabel, laura, david] = await Promise.all([
    prisma.patient.create({ data: { name: "Ana R." } }),
    prisma.patient.create({ data: { name: "Carlos M." } }),
    prisma.patient.create({ data: { name: "Isabel V." } }),
    prisma.patient.create({ data: { name: "Laura P." } }),
    prisma.patient.create({ data: { name: "David Q." } }),
  ]);

  // 7. Pacientes en lista de espera
  await Promise.all([
    prisma.patient.create({ data: { name: "Mónica T.", inWaitingList: true, waitingTreatmentId: endodoncia.id, waitingDurationSlots: 2, waitingValue: 180, priority: 4, availableNow: true,  easeScore: 5, preferredGabineteId: gab4.id } }),
    prisma.patient.create({ data: { name: "Luis F.",   inWaitingList: true, waitingTreatmentId: implante.id,   waitingDurationSlots: 3, waitingValue: 400, priority: 5, availableNow: false, easeScore: 2, preferredGabineteId: gab2.id } }),
    prisma.patient.create({ data: { name: "Jorge V.",  inWaitingList: true, waitingTreatmentId: limpieza.id,   waitingDurationSlots: 1, waitingValue: 60,  priority: 3, availableNow: true,  easeScore: 5 } }),
    prisma.patient.create({ data: { name: "Pilar R.",  inWaitingList: true, waitingTreatmentId: revision.id,   waitingDurationSlots: 2, waitingValue: 90,  priority: 2, availableNow: true,  easeScore: 4, preferredGabineteId: gab4.id } }),
  ]);

  // 8. Citas de hoy (date normalizada a medianoche; duration en minutos)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await Promise.all([
    prisma.appointment.create({ data: { date: today, startTime: "09:00", duration: 30, status: "confirmed", value: 45,  gabineteId: gab1.id, patientId: ana.id,    dentistId: drGarcia.id, treatmentTypeId: revision.id } }),
    prisma.appointment.create({ data: { date: today, startTime: "09:30", duration: 60, status: "confirmed", value: 120, gabineteId: gab1.id, patientId: carlos.id, dentistId: drGarcia.id, treatmentTypeId: empaste.id } }),
    prisma.appointment.create({ data: { date: today, startTime: "10:00", duration: 60, status: "confirmed", value: 160, gabineteId: gab2.id, patientId: isabel.id, dentistId: drMendez.id, treatmentTypeId: implanteRev.id } }),
    prisma.appointment.create({ data: { date: today, startTime: "11:00", duration: 60, status: "delayed",   value: 70,  gabineteId: gab3.id, patientId: laura.id,  dentistId: drRuiz.id,   treatmentTypeId: limpieza.id } }),
    prisma.appointment.create({ data: { date: today, startTime: "10:30", duration: 60, status: "cancelled", value: 150, gabineteId: gab4.id, patientId: david.id,  dentistId: drGarcia.id, treatmentTypeId: empasteX3.id } }),
  ]);
}
