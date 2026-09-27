-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "pixChargeExpiresAt" TIMESTAMP(3),
ADD COLUMN     "pixChargeId" TEXT,
ADD COLUMN     "pixManaged" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Subscription_pixManaged_status_idx" ON "Subscription"("pixManaged", "status");
