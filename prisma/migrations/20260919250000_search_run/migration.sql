-- SPEC-015
CREATE TABLE "SearchRun" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'running',
    "requests" INTEGER NOT NULL DEFAULT 0,
    "found" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "duplicate" INTEGER NOT NULL DEFAULT 0,
    "suppressed" INTEGER NOT NULL DEFAULT 0,
    "invalid" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "SearchRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SearchRun_campaignId_startedAt_idx" ON "SearchRun"("campaignId", "startedAt");
