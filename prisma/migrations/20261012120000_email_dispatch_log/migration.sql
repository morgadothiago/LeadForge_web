-- SPEC-052a: EmailDispatchLog (idempotencia generica de e-mails). Migration aditiva (so CREATE TABLE/INDEX).
-- Reverter manualmente: DROP TABLE "EmailDispatchLog";
-- CreateTable
CREATE TABLE "EmailDispatchLog" (
    "id" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "orgId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDispatchLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailDispatchLog_dedupeKey_key" ON "EmailDispatchLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "EmailDispatchLog_orgId_idx" ON "EmailDispatchLog"("orgId");
