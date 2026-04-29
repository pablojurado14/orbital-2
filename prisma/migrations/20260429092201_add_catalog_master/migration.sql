-- CreateTable
CREATE TABLE "Procedure" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "requiresProfessionalCapabilities" JSONB NOT NULL,
    "requiresRoomCapabilities" JSONB NOT NULL,
    "requiresEquipment" JSONB NOT NULL,
    "requiresAuxiliary" BOOLEAN NOT NULL DEFAULT false,
    "auxiliaryCapabilities" JSONB,
    "referenceDurationMean" DOUBLE PRECISION NOT NULL,
    "referenceDurationStdDev" DOUBLE PRECISION NOT NULL,
    "referenceDurationP10" DOUBLE PRECISION NOT NULL,
    "referenceDurationP50" DOUBLE PRECISION NOT NULL,
    "referenceDurationP90" DOUBLE PRECISION NOT NULL,
    "clinicalDependencies" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Procedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" SERIAL NOT NULL,
    "clinicId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "setupTimeMs" INTEGER,
    "cleanupTimeMs" INTEGER,
    "sterilizationCycleMs" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentRoom" (
    "equipmentId" INTEGER NOT NULL,
    "gabineteId" INTEGER NOT NULL,

    CONSTRAINT "EquipmentRoom_pkey" PRIMARY KEY ("equipmentId","gabineteId")
);

-- CreateTable
CREATE TABLE "ProcedureActivation" (
    "id" SERIAL NOT NULL,
    "clinicId" INTEGER NOT NULL,
    "procedureId" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "learnedDurationMean" DOUBLE PRECISION NOT NULL,
    "learnedDurationStdDev" DOUBLE PRECISION NOT NULL,
    "learnedDurationP10" DOUBLE PRECISION NOT NULL,
    "learnedDurationP50" DOUBLE PRECISION NOT NULL,
    "learnedDurationP90" DOUBLE PRECISION NOT NULL,
    "localRestrictions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcedureActivation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Procedure_category_idx" ON "Procedure"("category");

-- CreateIndex
CREATE INDEX "Procedure_active_idx" ON "Procedure"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Procedure_code_version_key" ON "Procedure"("code", "version");

-- CreateIndex
CREATE INDEX "Equipment_clinicId_idx" ON "Equipment"("clinicId");

-- CreateIndex
CREATE INDEX "Equipment_clinicId_type_idx" ON "Equipment"("clinicId", "type");

-- CreateIndex
CREATE INDEX "Equipment_clinicId_active_idx" ON "Equipment"("clinicId", "active");

-- CreateIndex
CREATE INDEX "EquipmentRoom_gabineteId_idx" ON "EquipmentRoom"("gabineteId");

-- CreateIndex
CREATE INDEX "ProcedureActivation_clinicId_idx" ON "ProcedureActivation"("clinicId");

-- CreateIndex
CREATE INDEX "ProcedureActivation_procedureId_idx" ON "ProcedureActivation"("procedureId");

-- CreateIndex
CREATE INDEX "ProcedureActivation_clinicId_active_idx" ON "ProcedureActivation"("clinicId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ProcedureActivation_clinicId_procedureId_key" ON "ProcedureActivation"("clinicId", "procedureId");

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "ClinicSettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRoom" ADD CONSTRAINT "EquipmentRoom_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRoom" ADD CONSTRAINT "EquipmentRoom_gabineteId_fkey" FOREIGN KEY ("gabineteId") REFERENCES "Gabinete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcedureActivation" ADD CONSTRAINT "ProcedureActivation_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "ClinicSettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcedureActivation" ADD CONSTRAINT "ProcedureActivation_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "Procedure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
