-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'EUR';

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "waitingCurrency" TEXT NOT NULL DEFAULT 'EUR';

-- AlterTable
ALTER TABLE "TreatmentType" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'EUR';
