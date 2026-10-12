-- SPEC-065 (065a): trial Free de 14 dias — contador de uso, anti-abuso do trial e novos lembretes. Migration ADITIVA (sem DROP, sem UPDATE de dados).
-- O plano `free` entra pelo seed (nao por migration).
-- Reverter manualmente: DROP TABLE "UsageCounter"; DROP TABLE "TrialClaim"; (valores de enum nao sao removiveis com ALTER TYPE; inofensivos).

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrialClaim" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_orgId_metric_periodKey_key" ON "UsageCounter"("orgId", "metric", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "TrialClaim_keyHash_key" ON "TrialClaim"("keyHash");

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterEnum: um valor por statement; nao usados nesta migration.
ALTER TYPE "BillingReminderKind" ADD VALUE 'trial_ending_d1';
ALTER TYPE "BillingReminderKind" ADD VALUE 'trial_expired';
