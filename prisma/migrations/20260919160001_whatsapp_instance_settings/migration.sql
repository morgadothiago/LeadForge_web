-- AlterTable
ALTER TABLE "Touch" ADD COLUMN     "whatsappInstanceId" TEXT;

-- AlterTable
ALTER TABLE "WhatsAppInstance" ADD COLUMN     "dailyLimit" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "lastConnectedAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT;

-- CreateIndex
CREATE INDEX "Touch_whatsappInstanceId_status_sentAt_idx" ON "Touch"("whatsappInstanceId", "status", "sentAt");

-- AddForeignKey
ALTER TABLE "Touch" ADD CONSTRAINT "Touch_whatsappInstanceId_fkey" FOREIGN KEY ("whatsappInstanceId") REFERENCES "WhatsAppInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
