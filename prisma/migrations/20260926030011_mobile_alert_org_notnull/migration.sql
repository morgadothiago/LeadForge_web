/*
  Warnings:

  - Made the column `orgId` on table `MobileAlert` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "MobileAlert" ALTER COLUMN "orgId" SET NOT NULL;
