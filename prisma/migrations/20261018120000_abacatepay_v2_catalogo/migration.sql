-- SPEC-063 (063a): catalogo de produtos AbacatePay v2 + elo do checkout. Migration ADITIVA (sem DROP, sem UPDATE de dados).
-- Reverter manualmente:
--   DROP TABLE "BillingProduct";
--   DROP INDEX "Subscription_externalCheckoutId_idx";
--   DROP INDEX "Subscription_externalSubscriptionId_idx";
--   ALTER TABLE "Subscription" DROP COLUMN "externalCheckoutId";

-- AlterTable: id do checkout de assinatura (`bill_...`), D-063-7.
ALTER TABLE "Subscription" ADD COLUMN "externalCheckoutId" TEXT;

-- CreateTable: catalogo de produtos (plano x cadencia x preco x chave), D-063-2.
CREATE TABLE "BillingProduct" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "keyFingerprint" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "cadence" "BillingCadence" NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "providerProductId" TEXT NOT NULL,
    "devMode" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Subscription_externalCheckoutId_idx" ON "Subscription"("externalCheckoutId");

-- CreateIndex
CREATE INDEX "Subscription_externalSubscriptionId_idx" ON "Subscription"("externalSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingProduct_provider_keyFingerprint_externalId_key" ON "BillingProduct"("provider", "keyFingerprint", "externalId");

-- CreateIndex
CREATE INDEX "BillingProduct_provider_keyFingerprint_providerProductId_idx" ON "BillingProduct"("provider", "keyFingerprint", "providerProductId");

-- AddForeignKey
ALTER TABLE "BillingProduct" ADD CONSTRAINT "BillingProduct_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
