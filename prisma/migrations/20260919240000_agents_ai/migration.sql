-- CreateEnum
CREATE TYPE "AgentRole" AS ENUM ('sdr', 'followup', 'closer');

-- CreateEnum
CREATE TYPE "AgentAutonomy" AS ENUM ('draft', 'sampled', 'auto');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('queued', 'running', 'completed', 'skipped', 'blocked', 'handoff', 'failed');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('pending', 'approved', 'edited', 'rejected', 'sent', 'expired', 'blocked');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "agentTurns" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "handoffAt" TIMESTAMP(3),
ADD COLUMN     "handoffReason" TEXT,
ADD COLUMN     "needsHuman" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SequenceStep" ADD COLUMN     "agentFallbackTemplate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "agentId" TEXT;

-- AlterTable
ALTER TABLE "Touch" ADD COLUMN     "agentGenerated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subject" TEXT;

-- CreateTable
CREATE TABLE "AgentSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "killSwitch" BOOLEAN NOT NULL DEFAULT true,
    "monthlyBudgetCents" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AgentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "role" "AgentRole" NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "persona" TEXT NOT NULL DEFAULT '',
    "objective" TEXT NOT NULL DEFAULT '',
    "tone" TEXT NOT NULL DEFAULT '',
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "model" TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
    "autonomy" "AgentAutonomy" NOT NULL DEFAULT 'draft',
    "samplePercent" INTEGER NOT NULL DEFAULT 20,
    "monthlyBudgetCents" INTEGER,
    "dailyMessageLimit" INTEGER NOT NULL DEFAULT 20,
    "maxTurnsPerLead" INTEGER NOT NULL DEFAULT 5,
    "allowedTools" TEXT[],
    "escalationRules" JSONB,
    "minConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "disclosureEnabled" BOOLEAN NOT NULL DEFAULT false,
    "disclosureText" TEXT,
    "callLink" TEXT,
    "autoConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "stepId" TEXT,
    "touchId" TEXT,
    "trigger" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'queued',
    "model" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "result" JSONB,
    "guardrailsViolated" TEXT[],
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'pending',
    "editedBody" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "touchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeDocument_agentId_idx" ON "KnowledgeDocument"("agentId");

-- CreateIndex
CREATE INDEX "AgentRun_status_createdAt_idx" ON "AgentRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_agentId_createdAt_idx" ON "AgentRun"("agentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_leadId_stepId_trigger_key" ON "AgentRun"("leadId", "stepId", "trigger");

-- CreateIndex
CREATE UNIQUE INDEX "Draft_agentRunId_key" ON "Draft"("agentRunId");

-- CreateIndex
CREATE INDEX "Draft_status_createdAt_idx" ON "Draft"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Draft_leadId_idx" ON "Draft"("leadId");

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SequenceStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

