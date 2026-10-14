-- SPEC-069f: briefing guiado do agente (JSON). Migration ADITIVA escrita a mao: um unico ADD COLUMN nulo, sem default e sem backfill.
-- Reverter manualmente: ALTER TABLE "Agent" DROP COLUMN "brief";

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "brief" JSONB;
