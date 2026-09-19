-- AlterEnum
ALTER TYPE "SequenceStatus" ADD VALUE 'paused_manual';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "autoStart" BOOLEAN NOT NULL DEFAULT false;
