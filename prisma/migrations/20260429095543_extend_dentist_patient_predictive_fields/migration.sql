-- AlterTable
ALTER TABLE "Dentist" ADD COLUMN     "capabilities" JSONB,
ADD COLUMN     "hourlyCost" DOUBLE PRECISION,
ADD COLUMN     "workSchedule" JSONB;

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "acceptAdviceScore" DOUBLE PRECISION,
ADD COLUMN     "latenessMeanMinutes" DOUBLE PRECISION,
ADD COLUMN     "latenessStdDevMinutes" DOUBLE PRECISION,
ADD COLUMN     "noShowScore" DOUBLE PRECISION;
