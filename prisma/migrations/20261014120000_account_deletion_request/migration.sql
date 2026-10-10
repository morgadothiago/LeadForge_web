-- SPEC-054a: AccountDeletionRequest (exclusao de conta LGPD). Migration ADITIVA (so CREATE TABLE/INDEX).
-- Reverter manualmente: DROP TABLE "AccountDeletionRequest";
-- CreateTable
CREATE TABLE "AccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "cancelTokenHash" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "scheduledFor" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "logsPurgedAt" TIMESTAMP(3),

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountDeletionRequest_tokenHash_key" ON "AccountDeletionRequest"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AccountDeletionRequest_cancelTokenHash_key" ON "AccountDeletionRequest"("cancelTokenHash");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_userId_requestedAt_idx" ON "AccountDeletionRequest"("userId", "requestedAt");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_scheduledFor_idx" ON "AccountDeletionRequest"("scheduledFor");
