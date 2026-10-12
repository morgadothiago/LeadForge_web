-- SPEC-062 (062a): cadastro sem trial + plano obrigatorio. Migration ADITIVA (sem DROP, sem UPDATE de dados).
-- Reverter manualmente:
--   DROP INDEX "Organization_setupPendingSince_idx";
--   ALTER TABLE "Organization" DROP COLUMN "setupPendingSince";
--   ALTER TABLE "Subscription" ALTER COLUMN "status" SET DEFAULT 'trialing';

-- AlterTable: casca de cobranca (D-062-5). null = organizacao normal.
ALTER TABLE "Organization" ADD COLUMN "setupPendingSince" TIMESTAMP(3);

-- AlterTable: nenhum caminho cria trial "por omissao" (D-062-16). Valores existentes nao mudam.
ALTER TABLE "Subscription" ALTER COLUMN "status" SET DEFAULT 'incomplete';

-- CreateIndex
CREATE INDEX "Organization_setupPendingSince_idx" ON "Organization"("setupPendingSince");
