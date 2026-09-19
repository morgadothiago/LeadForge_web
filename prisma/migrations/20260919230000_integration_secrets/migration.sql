-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('evolution', 'n8n', 'llm', 'places');

-- CreateEnum
CREATE TYPE "IntegrationAuditAction" AS ENUM ('create', 'rotate', 'delete', 'test', 'update_url');

-- CreateTable
CREATE TABLE "IntegrationSecret" (
    "id" TEXT NOT NULL,
    "integration" "IntegrationKind" NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "encryptedValue" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "baseUrl" TEXT,
    "allowPrivateHost" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestError" TEXT,

    CONSTRAINT "IntegrationSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "integration" "IntegrationKind" NOT NULL,
    "action" "IntegrationAuditAction" NOT NULL,
    "hostMasked" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSecret_integration_name_key" ON "IntegrationSecret"("integration", "name");

-- CreateIndex
CREATE INDEX "IntegrationAuditLog_integration_at_idx" ON "IntegrationAuditLog"("integration", "at");
