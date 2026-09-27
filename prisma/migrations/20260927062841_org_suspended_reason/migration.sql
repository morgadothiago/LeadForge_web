-- CreateEnum
CREATE TYPE "OrgSuspendedReason" AS ENUM ('automatic', 'manual');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "suspendedReason" "OrgSuspendedReason";
