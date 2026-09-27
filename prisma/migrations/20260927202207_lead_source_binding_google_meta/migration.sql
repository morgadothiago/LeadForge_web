-- CreateEnum
CREATE TYPE "LeadSourceProvider" AS ENUM ('google_ads', 'meta');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IntegrationKind" ADD VALUE 'google_ads_leads';
ALTER TYPE "IntegrationKind" ADD VALUE 'meta_leads';

-- CreateTable
CREATE TABLE "LeadSourceBinding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "provider" "LeadSourceProvider" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSourceBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadSourceBinding_orgId_idx" ON "LeadSourceBinding"("orgId");

-- CreateIndex
CREATE INDEX "LeadSourceBinding_campaignId_idx" ON "LeadSourceBinding"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSourceBinding_provider_externalAccountId_key" ON "LeadSourceBinding"("provider", "externalAccountId");

-- AddForeignKey
ALTER TABLE "LeadSourceBinding" ADD CONSTRAINT "LeadSourceBinding_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSourceBinding" ADD CONSTRAINT "LeadSourceBinding_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
