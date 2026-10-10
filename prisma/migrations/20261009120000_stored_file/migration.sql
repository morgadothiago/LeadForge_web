-- SPEC-050: StoredFile (metadado de arquivos no Azure Blob/local). Migration aditiva.
-- CreateEnum
CREATE TYPE "StoredFileCategory" AS ENUM ('creative', 'knowledge', 'attachment');

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "category" "StoredFileCategory" NOT NULL,
    "blobKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_blobKey_key" ON "StoredFile"("blobKey");

-- CreateIndex
CREATE INDEX "StoredFile_orgId_category_createdAt_idx" ON "StoredFile"("orgId", "category", "createdAt");

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
