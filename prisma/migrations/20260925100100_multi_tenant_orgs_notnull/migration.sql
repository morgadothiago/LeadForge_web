-- SPEC-030 (fase 2/2): roda DEPOIS de `src/scripts/backfill-org.ts` ter preenchido orgId em todas as
-- linhas existentes (e reescrito User.role para platform_admin|provider). Torna orgId obrigatorio,
-- troca os uniques globais por uniques por-org e cria os indices finais.

-- DropIndex (uniques globais que viram por-org)
DROP INDEX IF EXISTS "IntegrationSecret_integration_name_key";
DROP INDEX IF EXISTS "Suppression_kind_value_key";

-- AlterTable: orgId passa a ser obrigatorio
ALTER TABLE "Agent" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "AgentSettings" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Campaign" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "EmailAccount" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "IcpProfile" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "IntegrationAuditLog" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "IntegrationSecret" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "KnowledgeDocument" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "MeetingSettings" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "MessageTemplate" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "SchedulerRun" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Sequence" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Suppression" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "WhatsAppInstance" ALTER COLUMN "orgId" SET NOT NULL;
-- WebhookEvent.orgId permanece NULLABLE (nem todo evento resolve a org; ver Riscos SPEC-030).

-- CreateIndex
CREATE INDEX "Agent_orgId_idx" ON "Agent"("orgId");
CREATE UNIQUE INDEX "AgentSettings_orgId_key" ON "AgentSettings"("orgId");
CREATE INDEX "Campaign_orgId_status_idx" ON "Campaign"("orgId", "status");
CREATE INDEX "EmailAccount_orgId_idx" ON "EmailAccount"("orgId");
CREATE INDEX "IcpProfile_orgId_idx" ON "IcpProfile"("orgId");
CREATE INDEX "IntegrationAuditLog_orgId_integration_at_idx" ON "IntegrationAuditLog"("orgId", "integration", "at");
CREATE UNIQUE INDEX "IntegrationSecret_orgId_integration_name_key" ON "IntegrationSecret"("orgId", "integration", "name");
CREATE INDEX "KnowledgeDocument_orgId_idx" ON "KnowledgeDocument"("orgId");
CREATE UNIQUE INDEX "MeetingSettings_orgId_key" ON "MeetingSettings"("orgId");
CREATE INDEX "MessageTemplate_orgId_idx" ON "MessageTemplate"("orgId");
CREATE INDEX "SchedulerRun_orgId_startedAt_idx" ON "SchedulerRun"("orgId", "startedAt");
CREATE INDEX "Sequence_orgId_idx" ON "Sequence"("orgId");
CREATE INDEX "Suppression_orgId_createdAt_idx" ON "Suppression"("orgId", "createdAt");
CREATE UNIQUE INDEX "Suppression_orgId_kind_value_key" ON "Suppression"("orgId", "kind", "value");
CREATE INDEX "WebhookEvent_orgId_createdAt_idx" ON "WebhookEvent"("orgId", "createdAt");
CREATE INDEX "WhatsAppInstance_orgId_idx" ON "WhatsAppInstance"("orgId");
