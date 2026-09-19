-- AlterTable
ALTER TABLE "WhatsAppInstance" ADD COLUMN "disconnectedAt" TIMESTAMP(3);

-- Backfill complementar e idempotente da supressao global (SPEC-017). A migration 180000 nao normalizava telefone para E.164
-- (so trim) nem considerava sequenceStatus=opted_out sem optedOutAt. Mesma regra de normalizeBrPhone: [1-9][1-9]9 + 8 digitos, com 55 opcional.
WITH src AS (
  SELECT "id", "email", regexp_replace(COALESCE("phone", ''), '[^0-9]', '', 'g') AS d, COALESCE("optedOutAt", "updatedAt") AS at
  FROM "Lead" WHERE "optedOutAt" IS NOT NULL OR "sequenceStatus" = 'opted_out'
), norm AS (
  SELECT "id", at, CASE WHEN length(d) = 13 AND d LIKE '55%' THEN substr(d, 3) ELSE d END AS n FROM src
)
INSERT INTO "Suppression" ("id", "kind", "value", "reason", "leadId", "createdAt")
SELECT DISTINCT ON (n) gen_random_uuid()::text, 'phone'::"SuppressionKind", '+55' || n, 'opt_out_manual'::"SuppressionReason", "id", at
FROM norm WHERE n ~ '^[1-9][1-9]9[0-9]{8}$'
ORDER BY n, at
ON CONFLICT ("kind", "value") DO NOTHING;

INSERT INTO "Suppression" ("id", "kind", "value", "reason", "leadId", "createdAt")
SELECT DISTINCT ON (lower(trim("email"))) gen_random_uuid()::text, 'email'::"SuppressionKind", lower(trim("email")), 'opt_out_manual'::"SuppressionReason", "id", COALESCE("optedOutAt", "updatedAt")
FROM "Lead" WHERE ("optedOutAt" IS NOT NULL OR "sequenceStatus" = 'opted_out') AND "email" IS NOT NULL AND trim("email") <> ''
ORDER BY lower(trim("email")), COALESCE("optedOutAt", "updatedAt")
ON CONFLICT ("kind", "value") DO NOTHING;
