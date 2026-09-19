-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "possibleOptOut" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppInstance_webhookToken_key" ON "WhatsAppInstance"("webhookToken");
