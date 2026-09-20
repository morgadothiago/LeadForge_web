-- CreateTable
CREATE TABLE "MobileActionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "outcome" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "respStatus" INTEGER,
    "respBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileActionLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobileActionLog_deviceId_idempotencyKey_key" ON "MobileActionLog"("deviceId", "idempotencyKey");
CREATE INDEX "MobileActionLog_userId_createdAt_idx" ON "MobileActionLog"("userId", "createdAt");
