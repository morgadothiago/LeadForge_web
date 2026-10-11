-- SPEC-055: verificacao de e-mail. Migration ADITIVA.
-- D-055-3: ADD COLUMN com DEFAULT CURRENT_TIMESTAMP preenche TODOS os usuarios existentes como verificados (backfill),
-- sem bloquear ninguem; so cadastros self-service novos gravam NULL explicitamente (aplicacao).
-- Reverter manualmente: DROP TABLE "EmailVerificationToken"; ALTER TABLE "User" DROP COLUMN "emailVerifiedAt";
-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- Backfill explicito (idempotente; garante verificados mesmo se o default for removido no futuro)
UPDATE "User" SET "emailVerifiedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP) WHERE "emailVerifiedAt" IS NULL;

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_createdAt_idx" ON "EmailVerificationToken"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
