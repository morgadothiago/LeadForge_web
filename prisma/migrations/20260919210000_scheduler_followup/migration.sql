-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "sequenceStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Touch" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SchedulerRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "counters" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,

    CONSTRAINT "SchedulerRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchedulerRun_startedAt_idx" ON "SchedulerRun"("startedAt");

-- Backfill (SPEC-013): leads já iniciados ancoram a sequência no 1º Touch (ou na criação do lead).
UPDATE "Lead" SET "sequenceStartedAt" = COALESCE(
  (SELECT MIN(t."createdAt") FROM "Touch" t WHERE t."leadId" = "Lead"."id" AND t."direction" = 'outbound'),
  "createdAt"
) WHERE "sequenceStatus" <> 'not_started' AND "sequenceStartedAt" IS NULL;
