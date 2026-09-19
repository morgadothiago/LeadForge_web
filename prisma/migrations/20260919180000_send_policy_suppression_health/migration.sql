-- CreateEnum
CREATE TYPE "SuppressionKind" AS ENUM ('phone', 'email');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('opt_out_reply', 'opt_out_link', 'opt_out_manual', 'possible_opt_out_confirmed', 'bounce', 'manual');

-- CreateEnum
CREATE TYPE "InstanceHealth" AS ENUM ('good', 'warning', 'paused');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "hasWhatsapp" BOOLEAN,
ADD COLUMN     "whatsappCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WhatsAppInstance" ADD COLUMN     "health" "InstanceHealth" NOT NULL DEFAULT 'good',
ADD COLUMN     "healthResetAt" TIMESTAMP(3),
ADD COLUMN     "pausedReason" TEXT,
ADD COLUMN     "pausedUntil" TIMESTAMP(3),
ADD COLUMN     "warmupStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "InstanceAlert" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "InstanceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "kind" "SuppressionKind" NOT NULL,
    "value" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "leadId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstanceAlert_instanceId_createdAt_idx" ON "InstanceAlert"("instanceId", "createdAt");

-- CreateIndex
CREATE INDEX "Suppression_createdAt_idx" ON "Suppression"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_kind_value_key" ON "Suppression"("kind", "value");

-- AddForeignKey
ALTER TABLE "InstanceAlert" ADD CONSTRAINT "InstanceAlert_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsAppInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill idempotente (SPEC-017): opt-outs ja existentes entram na supressao global.
-- Telefones ja estao em E.164 (schema Zod); e-mails em lowercase/trim.
UPDATE "WhatsAppInstance" SET "warmupStartedAt" = "lastConnectedAt" WHERE "warmupStartedAt" IS NULL AND "lastConnectedAt" IS NOT NULL;

INSERT INTO "Suppression" ("id", "kind", "value", "reason", "leadId", "createdAt")
SELECT DISTINCT ON (lower(trim("email"))) gen_random_uuid()::text, 'email'::"SuppressionKind", lower(trim("email")), 'opt_out_manual'::"SuppressionReason", "id", COALESCE("optedOutAt", now())
FROM "Lead" WHERE "optedOutAt" IS NOT NULL AND "email" IS NOT NULL AND trim("email") <> ''
ORDER BY lower(trim("email")), "optedOutAt"
ON CONFLICT ("kind", "value") DO NOTHING;

INSERT INTO "Suppression" ("id", "kind", "value", "reason", "leadId", "createdAt")
SELECT DISTINCT ON (trim("phone")) gen_random_uuid()::text, 'phone'::"SuppressionKind", trim("phone"), 'opt_out_manual'::"SuppressionReason", "id", COALESCE("optedOutAt", now())
FROM "Lead" WHERE "optedOutAt" IS NOT NULL AND "phone" IS NOT NULL AND trim("phone") <> ''
ORDER BY trim("phone"), "optedOutAt"
ON CONFLICT ("kind", "value") DO NOTHING;
