-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "dailyLimit" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "fromName" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Touch" ADD COLUMN     "emailAccountId" TEXT;

-- CreateIndex
CREATE INDEX "Touch_emailAccountId_status_sentAt_idx" ON "Touch"("emailAccountId", "status", "sentAt");

-- AddForeignKey
ALTER TABLE "Touch" ADD CONSTRAINT "Touch_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
