/*
  Warnings:

  - You are about to drop the column `inWaitingList` on the `Patient` table. All the data in the column will be lost.
  - You are about to drop the column `waitingCurrency` on the `Patient` table. All the data in the column will be lost.
  - You are about to drop the column `waitingDurationSlots` on the `Patient` table. All the data in the column will be lost.
  - You are about to drop the column `waitingTreatmentId` on the `Patient` table. All the data in the column will be lost.
  - You are about to drop the column `waitingValue` on the `Patient` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Patient" DROP CONSTRAINT "Patient_waitingTreatmentId_fkey";

-- AlterTable
ALTER TABLE "Patient" DROP COLUMN "inWaitingList",
DROP COLUMN "waitingCurrency",
DROP COLUMN "waitingDurationSlots",
DROP COLUMN "waitingTreatmentId",
DROP COLUMN "waitingValue";
