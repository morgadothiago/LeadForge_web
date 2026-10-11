-- SPEC-060: cursor de paginacao da busca Places. Migration ADITIVA (colunas anulaveis/default).
-- Reverter manualmente: ALTER TABLE "SearchRun" DROP COLUMN "pageToken", DROP COLUMN "searchQuery", DROP COLUMN "variant";
-- AlterTable
ALTER TABLE "SearchRun" ADD COLUMN "pageToken" TEXT,
ADD COLUMN "searchQuery" TEXT,
ADD COLUMN "variant" INTEGER NOT NULL DEFAULT 0;
