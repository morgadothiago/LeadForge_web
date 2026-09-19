-- CreateTable
CREATE TABLE "StageHistory" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "fromStage" "Stage",
    "toStage" "Stage" NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StageHistory_opportunityId_changedAt_idx" ON "StageHistory"("opportunityId", "changedAt");

-- CreateIndex
CREATE INDEX "StageHistory_toStage_changedAt_idx" ON "StageHistory"("toStage", "changedAt");

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
