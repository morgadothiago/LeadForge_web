-- SPEC-051a: reversao MANUAL (o Prisma nao executa este arquivo). Perde os criativos/jobs (os blobs em StoredFile permanecem; purgue-os antes se necessario).
DROP TABLE IF EXISTS "CreativeJob";
DROP TABLE IF EXISTS "Creative";
DROP TYPE IF EXISTS "CreativeJobStatus";
DROP TYPE IF EXISTS "CreativeStatus";
-- Em ambiente com _prisma_migrations: DELETE FROM "_prisma_migrations" WHERE migration_name = '20261011120000_creatives';
