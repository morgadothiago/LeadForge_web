-- SPEC-030 (fase 1/2): estrutura multi-tenant. orgId entra NULLABLE aqui de proposito -- o backfill
-- de dados roda em `src/scripts/backfill-org.ts` (script separado, fora do `prisma migrate`) antes da
-- fase 2 (`20260925100100_multi_tenant_orgs_notnull`), que torna as colunas obrigatorias e cria os
-- indices/uniques/FKs finais. Rodar as duas migrations sem backfill entre elas quebra a fase 2 em bancos
-- com dados existentes.

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('active', 'suspended', 'cancelled');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('owner', 'member');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orgRole" "OrgRole" NOT NULL DEFAULT 'owner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE INDEX "Organization_status_idx" ON "Organization"("status");
CREATE INDEX "Membership_orgId_idx" ON "Membership"("orgId");
CREATE UNIQUE INDEX "Membership_userId_orgId_key" ON "Membership"("userId", "orgId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: orgId NULLABLE por enquanto (backfill em src/scripts/backfill-org.ts, depois fase 2 seta NOT NULL)
ALTER TABLE "Agent" ADD COLUMN "orgId" TEXT;
ALTER TABLE "AgentSettings" ADD COLUMN "orgId" TEXT, ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "Campaign" ADD COLUMN "orgId" TEXT;
ALTER TABLE "EmailAccount" ADD COLUMN "orgId" TEXT;
ALTER TABLE "IcpProfile" ADD COLUMN "orgId" TEXT;
ALTER TABLE "IntegrationAuditLog" ADD COLUMN "orgId" TEXT;
ALTER TABLE "IntegrationSecret" ADD COLUMN "orgId" TEXT;
ALTER TABLE "KnowledgeDocument" ADD COLUMN "orgId" TEXT;
ALTER TABLE "MeetingSettings" ADD COLUMN "orgId" TEXT, ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "MessageTemplate" ADD COLUMN "orgId" TEXT;
ALTER TABLE "SchedulerRun" ADD COLUMN "orgId" TEXT;
ALTER TABLE "Sequence" ADD COLUMN "orgId" TEXT;
ALTER TABLE "Suppression" ADD COLUMN "orgId" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN "orgId" TEXT;
ALTER TABLE "WhatsAppInstance" ADD COLUMN "orgId" TEXT;

-- AlterTable: User.role passa a ser papel de PLATAFORMA (D-30-1). Default novo para cadastros futuros;
-- reescrita dos valores existentes ("admin"/"member" -> "platform_admin"/"provider") acontece no backfill.
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'provider';

-- FKs de orgId -> Organization (ON DELETE ajustado por tabela; nullable ainda permite FK)
ALTER TABLE "IcpProfile" ADD CONSTRAINT "IcpProfile_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeetingSettings" ADD CONSTRAINT "MeetingSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppInstance" ADD CONSTRAINT "WhatsAppInstance_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SchedulerRun" ADD CONSTRAINT "SchedulerRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationSecret" ADD CONSTRAINT "IntegrationSecret_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationAuditLog" ADD CONSTRAINT "IntegrationAuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentSettings" ADD CONSTRAINT "AgentSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
