-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "actualEndTime" TIMESTAMP(3),
ADD COLUMN     "actualStartTime" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AppointmentEquipment" (
    "appointmentId" INTEGER NOT NULL,
    "equipmentId" INTEGER NOT NULL,
    "reservedFromMs" BIGINT NOT NULL,
    "reservedToMs" BIGINT NOT NULL,

    CONSTRAINT "AppointmentEquipment_pkey" PRIMARY KEY ("appointmentId","equipmentId","reservedFromMs")
);

-- CreateTable
CREATE TABLE "ConstraintRule" (
    "id" SERIAL NOT NULL,
    "clinicId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "hardness" TEXT NOT NULL,
    "referencedEntities" JSONB NOT NULL,
    "parameters" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConstraintRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" SERIAL NOT NULL,
    "clinicId" INTEGER NOT NULL,
    "patientId" INTEGER NOT NULL,
    "desiredProcedureId" INTEGER,
    "desiredTreatmentTypeId" INTEGER,
    "durationSlots" INTEGER NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "availableNow" BOOLEAN NOT NULL DEFAULT true,
    "easeScore" INTEGER NOT NULL DEFAULT 5,
    "urgency" INTEGER DEFAULT 3,
    "availabilityWindow" JSONB,
    "preferredContactChannel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppointmentEquipment_equipmentId_reservedFromMs_idx" ON "AppointmentEquipment"("equipmentId", "reservedFromMs");

-- CreateIndex
CREATE INDEX "AppointmentEquipment_appointmentId_idx" ON "AppointmentEquipment"("appointmentId");

-- CreateIndex
CREATE INDEX "ConstraintRule_clinicId_idx" ON "ConstraintRule"("clinicId");

-- CreateIndex
CREATE INDEX "ConstraintRule_clinicId_active_idx" ON "ConstraintRule"("clinicId", "active");

-- CreateIndex
CREATE INDEX "ConstraintRule_clinicId_code_idx" ON "ConstraintRule"("clinicId", "code");

-- CreateIndex
CREATE INDEX "WaitlistEntry_clinicId_idx" ON "WaitlistEntry"("clinicId");

-- CreateIndex
CREATE INDEX "WaitlistEntry_clinicId_patientId_idx" ON "WaitlistEntry"("clinicId", "patientId");

-- CreateIndex
CREATE INDEX "WaitlistEntry_clinicId_availableNow_idx" ON "WaitlistEntry"("clinicId", "availableNow");

-- CreateIndex
CREATE INDEX "WaitlistEntry_patientId_idx" ON "WaitlistEntry"("patientId");

-- CreateIndex
CREATE INDEX "WaitlistEntry_desiredProcedureId_idx" ON "WaitlistEntry"("desiredProcedureId");

-- CreateIndex
CREATE INDEX "WaitlistEntry_desiredTreatmentTypeId_idx" ON "WaitlistEntry"("desiredTreatmentTypeId");

-- AddForeignKey
ALTER TABLE "AppointmentEquipment" ADD CONSTRAINT "AppointmentEquipment_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentEquipment" ADD CONSTRAINT "AppointmentEquipment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstraintRule" ADD CONSTRAINT "ConstraintRule_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "ClinicSettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "ClinicSettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_desiredProcedureId_fkey" FOREIGN KEY ("desiredProcedureId") REFERENCES "Procedure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_desiredTreatmentTypeId_fkey" FOREIGN KEY ("desiredTreatmentTypeId") REFERENCES "TreatmentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
