-- SPEC-069c: politica por organizacao escrita pelo platform_admin. Migration ADITIVA escrita a mao (so ADD COLUMN com default/nullable e ADD VALUE em enum;
-- sem DROP/UPDATE/ALTER destrutivo; sem backfill). Os valores novos do enum NAO sao usados nesta migration (ADD VALUE nao pode ser usado na mesma transacao).
-- Reverter manualmente (valores de enum nao sao removiveis; inofensivos): ALTER TABLE "AgentSettings" DROP COLUMN "lockedByAdmin"; ALTER TABLE "IntegrationSecret" DROP COLUMN "managedByPlatform"; ALTER TABLE "PlatformAuditLog" DROP COLUMN "meta".

-- AlterEnum (um valor por statement)
ALTER TYPE "PlatformAuditAction" ADD VALUE 'entitlement_override_set';
ALTER TYPE "PlatformAuditAction" ADD VALUE 'entitlement_override_clear';
ALTER TYPE "PlatformAuditAction" ADD VALUE 'agent_settings_set';
ALTER TYPE "PlatformAuditAction" ADD VALUE 'agent_policy_set';
ALTER TYPE "PlatformAuditAction" ADD VALUE 'integration_key_set';
ALTER TYPE "PlatformAuditAction" ADD VALUE 'integration_key_remove';

-- AlterTable
ALTER TABLE "AgentSettings" ADD COLUMN "lockedByAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "IntegrationSecret" ADD COLUMN "managedByPlatform" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlatformAuditLog" ADD COLUMN "meta" JSONB;
