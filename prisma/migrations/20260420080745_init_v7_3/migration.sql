-- CreateTable
CREATE TABLE "ClinicSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "name" TEXT NOT NULL DEFAULT 'Mi Clínica Dental',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DaySchedule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dayOfWeek" INTEGER NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "morningOpen" TEXT,
    "morningClose" TEXT,
    "afternoonOpen" TEXT,
    "afternoonClose" TEXT,
    "clinicId" INTEGER NOT NULL,
    CONSTRAINT "DaySchedule_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "ClinicSettings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Gabinete" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Dentist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "specialty" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "TreatmentType" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#E0F2FE',
    "price" REAL,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inWaitingList" BOOLEAN NOT NULL DEFAULT false,
    "waitingTreatmentId" INTEGER,
    "waitingDurationSlots" INTEGER,
    "waitingValue" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "availableNow" BOOLEAN NOT NULL DEFAULT true,
    "easeScore" INTEGER NOT NULL DEFAULT 5,
    "preferredGabineteId" INTEGER,
    "preferredDentistId" INTEGER,
    CONSTRAINT "Patient_preferredGabineteId_fkey" FOREIGN KEY ("preferredGabineteId") REFERENCES "Gabinete" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Patient_preferredDentistId_fkey" FOREIGN KEY ("preferredDentistId") REFERENCES "Dentist" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Patient_waitingTreatmentId_fkey" FOREIGN KEY ("waitingTreatmentId") REFERENCES "TreatmentType" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "startTime" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "duration" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "value" REAL,
    "notes" TEXT,
    "patientId" INTEGER NOT NULL,
    "dentistId" INTEGER NOT NULL,
    "gabineteId" INTEGER NOT NULL,
    "treatmentTypeId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_dentistId_fkey" FOREIGN KEY ("dentistId") REFERENCES "Dentist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_gabineteId_fkey" FOREIGN KEY ("gabineteId") REFERENCES "Gabinete" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_treatmentTypeId_fkey" FOREIGN KEY ("treatmentTypeId") REFERENCES "TreatmentType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RuntimeState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "suggestionDecision" TEXT NOT NULL DEFAULT 'pending'
);

-- CreateIndex
CREATE UNIQUE INDEX "DaySchedule_clinicId_dayOfWeek_key" ON "DaySchedule"("clinicId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "Gabinete_name_key" ON "Gabinete"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TreatmentType_name_key" ON "TreatmentType"("name");
