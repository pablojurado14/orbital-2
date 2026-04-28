-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "clinicId" INTEGER;

-- AlterTable
ALTER TABLE "ClinicSettings" ADD COLUMN     "pesosKpi" JSONB,
ADD COLUMN     "politicaAutonomia" JSONB,
ADD COLUMN     "umbralDisparoProactivo" DOUBLE PRECISION,
ADD COLUMN     "zonaHoraria" TEXT NOT NULL DEFAULT 'Europe/Madrid';

-- AlterTable
ALTER TABLE "Dentist" ADD COLUMN     "clinicId" INTEGER;

-- AlterTable
ALTER TABLE "Gabinete" ADD COLUMN     "clinicId" INTEGER;

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "clinicId" INTEGER;

-- AlterTable
ALTER TABLE "RuntimeState" ADD COLUMN     "clinicId" INTEGER;

-- AlterTable
ALTER TABLE "TreatmentType" ADD COLUMN     "clinicId" INTEGER;

-- CreateIndex
CREATE INDEX "Appointment_clinicId_date_idx" ON "Appointment"("clinicId", "date");

-- CreateIndex
CREATE INDEX "Appointment_date_idx" ON "Appointment"("date");

-- CreateIndex
CREATE INDEX "Appointment_gabineteId_date_idx" ON "Appointment"("gabineteId", "date");

-- CreateIndex
CREATE INDEX "Appointment_patientId_idx" ON "Appointment"("patientId");

-- CreateIndex
CREATE INDEX "Dentist_clinicId_idx" ON "Dentist"("clinicId");

-- CreateIndex
CREATE INDEX "Gabinete_clinicId_idx" ON "Gabinete"("clinicId");

-- CreateIndex
CREATE INDEX "Patient_clinicId_idx" ON "Patient"("clinicId");

-- CreateIndex
CREATE INDEX "RuntimeState_clinicId_idx" ON "RuntimeState"("clinicId");

-- CreateIndex
CREATE INDEX "TreatmentType_clinicId_idx" ON "TreatmentType"("clinicId");

-- AddForeignKey
ALTER TABLE "Gabinete" ADD CONSTRAINT "Gabinete_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "ClinicSettings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dentist" ADD CONSTRAINT "Dentist_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "ClinicSettings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentType" ADD CONSTRAINT "TreatmentType_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "ClinicSettings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "ClinicSettings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "ClinicSettings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuntimeState" ADD CONSTRAINT "RuntimeState_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "ClinicSettings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
