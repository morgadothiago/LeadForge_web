-- AlterTable
ALTER TABLE "MobileDevice" ADD COLUMN "pushPrefs" JSONB;

-- CreateTable
CREATE TABLE "MobileAlert" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "MobileAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobileAlert_dedupeKey_key" ON "MobileAlert"("dedupeKey");
CREATE INDEX "MobileAlert_createdAt_id_idx" ON "MobileAlert"("createdAt", "id");
CREATE INDEX "MobileAlert_kind_resolvedAt_idx" ON "MobileAlert"("kind", "resolvedAt");
