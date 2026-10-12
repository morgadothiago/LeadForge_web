-- SPEC-068a: caixa de atendimento de WhatsApp (WaConversation + WaMessage). Migration ADITIVA escrita a mao (sem ALTER/DROP/UPDATE em tabela existente; sem backfill: o historico entra pelo script `npm run inbox:backfill`).
-- Aplicar so com `prisma migrate deploy` (nunca `migrate dev`: ha drift 20260928*).
-- Reverter manualmente: DROP TABLE "WaMessage"; DROP TABLE "WaConversation"; DROP TYPE "WaMessageStatus"; DROP TYPE "WaMessageKind"; DROP TYPE "WaMessageOrigin"; DROP TYPE "WaMessageDirection"; DROP TYPE "WaConversationStatus";
-- CreateEnum
CREATE TYPE "WaConversationStatus" AS ENUM ('waiting', 'attending', 'closed');

-- CreateEnum
CREATE TYPE "WaMessageDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "WaMessageOrigin" AS ENUM ('lead', 'automation', 'manual', 'device');

-- CreateEnum
CREATE TYPE "WaMessageKind" AS ENUM ('text', 'image', 'audio', 'document', 'video', 'other');

-- CreateEnum
CREATE TYPE "WaMessageStatus" AS ENUM ('sending', 'sent', 'delivered', 'read', 'failed');

-- CreateTable
CREATE TABLE "WaConversation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "whatsappInstanceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "status" "WaConversationStatus" NOT NULL DEFAULT 'waiting',
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "lastInboundAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "lastMessageDirection" "WaMessageDirection",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaMessage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "whatsappInstanceId" TEXT NOT NULL,
    "direction" "WaMessageDirection" NOT NULL,
    "origin" "WaMessageOrigin" NOT NULL,
    "kind" "WaMessageKind" NOT NULL DEFAULT 'text',
    "body" TEXT NOT NULL DEFAULT '',
    "externalId" TEXT,
    "clientMessageId" TEXT,
    "status" "WaMessageStatus" NOT NULL,
    "error" TEXT,
    "sentByUserId" TEXT,
    "touchId" TEXT,
    "attachmentFileId" TEXT,
    "attachmentName" TEXT,
    "attachmentMime" TEXT,
    "attachmentSize" INTEGER,
    "messageAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaConversation_orgId_status_lastMessageAt_idx" ON "WaConversation"("orgId", "status", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "WaConversation_orgId_leadId_idx" ON "WaConversation"("orgId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "WaConversation_whatsappInstanceId_contactPhone_key" ON "WaConversation"("whatsappInstanceId", "contactPhone");

-- CreateIndex
CREATE INDEX "WaMessage_conversationId_messageAt_id_idx" ON "WaMessage"("conversationId", "messageAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "WaMessage_whatsappInstanceId_externalId_key" ON "WaMessage"("whatsappInstanceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "WaMessage_orgId_clientMessageId_key" ON "WaMessage"("orgId", "clientMessageId");

-- AddForeignKey
ALTER TABLE "WaConversation" ADD CONSTRAINT "WaConversation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaConversation" ADD CONSTRAINT "WaConversation_whatsappInstanceId_fkey" FOREIGN KEY ("whatsappInstanceId") REFERENCES "WhatsAppInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaConversation" ADD CONSTRAINT "WaConversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WaConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_whatsappInstanceId_fkey" FOREIGN KEY ("whatsappInstanceId") REFERENCES "WhatsAppInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_touchId_fkey" FOREIGN KEY ("touchId") REFERENCES "Touch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_attachmentFileId_fkey" FOREIGN KEY ("attachmentFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

