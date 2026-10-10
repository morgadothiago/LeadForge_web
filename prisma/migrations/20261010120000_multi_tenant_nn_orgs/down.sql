-- SPEC-049a: reversao MANUAL (o Prisma nao executa este arquivo). Nao ha perda de dados pre-existentes (tudo aditivo).
DROP TABLE IF EXISTS "OrgAuditLog";
DROP TABLE IF EXISTS "OrgInvite";
DROP INDEX IF EXISTS "Organization_joinCode_key";
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "joinCode", DROP COLUMN IF EXISTS "joinCodeExpiresAt", DROP COLUMN IF EXISTS "joinCodeMaxUses", DROP COLUMN IF EXISTS "joinCodeUses";
ALTER TABLE "User" DROP COLUMN IF EXISTS "lastOrgId";
-- Em ambiente com _prisma_migrations: DELETE FROM "_prisma_migrations" WHERE migration_name = '20261010120000_multi_tenant_nn_orgs';
