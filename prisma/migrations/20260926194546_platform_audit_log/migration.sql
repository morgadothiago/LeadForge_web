-- CreateEnum
CREATE TYPE "PlatformAuditAction" AS ENUM ('suspend', 'reactivate');

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "action" "PlatformAuditAction" NOT NULL,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformAuditLog_orgId_at_idx" ON "PlatformAuditLog"("orgId", "at");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_adminUserId_at_idx" ON "PlatformAuditLog"("adminUserId", "at");

-- AddForeignKey
ALTER TABLE "PlatformAuditLog" ADD CONSTRAINT "PlatformAuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
