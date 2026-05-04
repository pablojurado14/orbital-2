-- CreateTable
CREATE TABLE "RejectedCandidate" (
    "id" SERIAL NOT NULL,
    "clinicId" INTEGER NOT NULL,
    "gapEventId" TEXT NOT NULL,
    "waitingCandidateId" TEXT NOT NULL,
    "rejectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RejectedCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RejectedCandidate_clinicId_gapEventId_idx" ON "RejectedCandidate"("clinicId", "gapEventId");

-- CreateIndex
CREATE INDEX "RejectedCandidate_clinicId_rejectedAt_idx" ON "RejectedCandidate"("clinicId", "rejectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RejectedCandidate_clinicId_gapEventId_waitingCandidateId_key" ON "RejectedCandidate"("clinicId", "gapEventId", "waitingCandidateId");

-- AddForeignKey
ALTER TABLE "RejectedCandidate" ADD CONSTRAINT "RejectedCandidate_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "ClinicSettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
