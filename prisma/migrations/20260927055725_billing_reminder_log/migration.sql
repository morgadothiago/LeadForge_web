-- CreateEnum
CREATE TYPE "BillingReminderKind" AS ENUM ('trial_ending', 'past_due_started', 'auto_suspended', 'purge_warning');

-- CreateTable
CREATE TABLE "BillingReminderLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "BillingReminderKind" NOT NULL,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingReminderLog_orgId_kind_idx" ON "BillingReminderLog"("orgId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "BillingReminderLog_orgId_kind_anchorAt_key" ON "BillingReminderLog"("orgId", "kind", "anchorAt");

-- AddForeignKey
ALTER TABLE "BillingReminderLog" ADD CONSTRAINT "BillingReminderLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
