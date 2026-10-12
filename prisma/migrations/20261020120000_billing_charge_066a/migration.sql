-- SPEC-066a: historico de cobrancas (BillingCharge). Migration ADITIVA escrita a mao (sem DROP/UPDATE/ALTER em tabelas existentes; sem backfill).
-- Reverter manualmente: DROP TABLE "BillingCharge"; DROP TYPE "BillingChargeMethod"; DROP TYPE "BillingChargeStatus";

-- CreateEnum
CREATE TYPE "BillingChargeStatus" AS ENUM ('pending', 'paid', 'failed', 'refunded', 'canceled');

-- CreateEnum
CREATE TYPE "BillingChargeMethod" AS ENUM ('card', 'pix');

-- CreateTable
CREATE TABLE "BillingCharge" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "status" "BillingChargeStatus" NOT NULL,
    "method" "BillingChargeMethod" NOT NULL,
    "planKey" TEXT NOT NULL,
    "cadence" "BillingCadence" NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "receiptUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingCharge_provider_externalId_key" ON "BillingCharge"("provider", "externalId");

-- CreateIndex
CREATE INDEX "BillingCharge_orgId_createdAt_id_idx" ON "BillingCharge"("orgId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "BillingCharge_orgId_status_idx" ON "BillingCharge"("orgId", "status");

-- AddForeignKey
ALTER TABLE "BillingCharge" ADD CONSTRAINT "BillingCharge_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
