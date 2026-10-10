-- SPEC-051a: Creative + CreativeJob (criativos de video com avatar IA). Migration aditiva (ver down.sql para reverter manualmente).
-- CreateEnum
CREATE TYPE "CreativeStatus" AS ENUM ('draft', 'queued', 'processing', 'ready', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "CreativeJobStatus" AS ENUM ('queued', 'processing', 'succeeded', 'failed', 'canceled');

-- CreateTable
CREATE TABLE "Creative" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CreativeStatus" NOT NULL DEFAULT 'draft',
    "script" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "avatarRef" TEXT NOT NULL,
    "voiceRef" TEXT NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "durationSec" INTEGER,
    "thumbnailFileId" TEXT,
    "videoFileId" TEXT,
    "createdBy" TEXT NOT NULL,
    "error" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Creative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "runNo" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerJobId" TEXT,
    "status" "CreativeJobStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "lastPolledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "progressPct" INTEGER,
    "costEstimateCents" INTEGER,
    "costActualCents" INTEGER,
    "rawStatus" TEXT,
    "failureKind" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Creative_orgId_status_createdAt_idx" ON "Creative"("orgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Creative_orgId_submittedAt_idx" ON "Creative"("orgId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeJob_idempotencyKey_key" ON "CreativeJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CreativeJob_status_nextRunAt_idx" ON "CreativeJob"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "CreativeJob_orgId_creativeId_idx" ON "CreativeJob"("orgId", "creativeId");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeJob_creativeId_runNo_key" ON "CreativeJob"("creativeId", "runNo");

-- AddForeignKey
ALTER TABLE "Creative" ADD CONSTRAINT "Creative_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creative" ADD CONSTRAINT "Creative_thumbnailFileId_fkey" FOREIGN KEY ("thumbnailFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creative" ADD CONSTRAINT "Creative_videoFileId_fkey" FOREIGN KEY ("videoFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeJob" ADD CONSTRAINT "CreativeJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeJob" ADD CONSTRAINT "CreativeJob_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Creative"("id") ON DELETE CASCADE ON UPDATE CASCADE;
