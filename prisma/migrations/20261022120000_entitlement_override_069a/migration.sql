-- SPEC-069a: override manual de funcionalidades/limites por organizacao. Migration ADITIVA escrita a mao (so CREATE TABLE/INDEX + FK da tabela nova; sem DROP/UPDATE/ALTER em tabelas existentes; sem backfill).
-- Reverter manualmente: DROP TABLE "OrgEntitlementOverride";

-- CreateTable
CREATE TABLE "OrgEntitlementOverride" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "features" JSONB NOT NULL DEFAULT '{}',
    "limits" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgEntitlementOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgEntitlementOverride_orgId_key" ON "OrgEntitlementOverride"("orgId");

-- AddForeignKey
ALTER TABLE "OrgEntitlementOverride" ADD CONSTRAINT "OrgEntitlementOverride_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
