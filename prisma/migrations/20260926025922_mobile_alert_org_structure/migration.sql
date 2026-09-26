-- AlterTable
ALTER TABLE "MobileAlert" ADD COLUMN     "orgId" TEXT;

-- CreateIndex
CREATE INDEX "MobileAlert_orgId_createdAt_id_idx" ON "MobileAlert"("orgId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "MobileAlert_orgId_kind_resolvedAt_idx" ON "MobileAlert"("orgId", "kind", "resolvedAt");

-- AddForeignKey
ALTER TABLE "MobileAlert" ADD CONSTRAINT "MobileAlert_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
