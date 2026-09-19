-- AlterEnum
ALTER TYPE "TouchStatus" ADD VALUE 'sending';

-- AlterTable
ALTER TABLE "Touch" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
