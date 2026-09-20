-- CreateTable
CREATE TABLE "MobileDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "prevRefreshHash" TEXT,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "pushToken" TEXT,
    "appVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MobileDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MobileDevice_refreshHash_key" ON "MobileDevice"("refreshHash");
CREATE INDEX "MobileDevice_userId_createdAt_idx" ON "MobileDevice"("userId", "createdAt");
CREATE INDEX "MobileDevice_prevRefreshHash_idx" ON "MobileDevice"("prevRefreshHash");
