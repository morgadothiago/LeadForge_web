-- SPEC-028: Meeting aditiva (preserva dados existentes) + MeetingSettings.
CREATE TYPE "MeetingStatus" AS ENUM ('scheduled', 'done', 'cancelled', 'no_show');
CREATE TYPE "MeetingSource" AS ENUM ('manual', 'agent', 'webhook');

-- scheduledAt -> startsAt (rename preserva os dados)
ALTER TABLE "Meeting" RENAME COLUMN "scheduledAt" TO "startsAt";

ALTER TABLE "Meeting"
  ADD COLUMN "endsAt" TIMESTAMP(3),
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  ADD COLUMN "link" TEXT,
  ADD COLUMN "source" "MeetingSource" NOT NULL DEFAULT 'manual',
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "externalId" TEXT,
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "campaignId" TEXT;

UPDATE "Meeting" SET "endsAt" = "startsAt" + ("duration" * INTERVAL '1 minute');
UPDATE "Meeting" m SET "campaignId" = o."campaignId" FROM "Opportunity" o WHERE o."id" = m."opportunityId";
ALTER TABLE "Meeting" ALTER COLUMN "endsAt" SET NOT NULL;
ALTER TABLE "Meeting" ALTER COLUMN "campaignId" SET NOT NULL;

-- status String -> enum (valor desconhecido vira scheduled)
ALTER TABLE "Meeting" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Meeting" ALTER COLUMN "status" TYPE "MeetingStatus" USING (
  CASE WHEN "status" IN ('scheduled', 'done', 'cancelled', 'no_show') THEN "status" ELSE 'scheduled' END
)::"MeetingStatus";
ALTER TABLE "Meeting" ALTER COLUMN "status" SET DEFAULT 'scheduled';

CREATE UNIQUE INDEX "Meeting_externalId_key" ON "Meeting"("externalId");
CREATE INDEX "Meeting_campaignId_idx" ON "Meeting"("campaignId");
CREATE INDEX "Meeting_startsAt_idx" ON "Meeting"("startsAt");
CREATE INDEX "Meeting_status_startsAt_idx" ON "Meeting"("status", "startsAt");
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MeetingSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "offsetsMin" INTEGER[] DEFAULT ARRAY[1440, 60, 15]::INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingSettings_pkey" PRIMARY KEY ("id")
);
