import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordOrgAudit } from "@/lib/org/audit";
import { uniqueOrgSlug } from "@/lib/org/slug";
import type { ParsedDocument } from "@/lib/domain/document";
import { computeOrgStatus } from "./status-map";
import { TRIAL_MS, claimTrial } from "./trial-claim";

/**
 * SPEC-065 (D-065-7/23/27) — cria, numa UNICA transacao, `User` + `Organization` + `Membership(owner)` + `Subscription(free, trialing)` +
 * os 2 `TrialClaim` (e-mail canonico e CPF/CNPJ). Falha em qualquer passo = NADA criado. Conflito de claim (ou `denyTrial`: IP/dominio
 * descartavel) = conta e organizacao criadas MAS com `trialEndsAt = agora` (trial ja expirado; org `suspended`/`automatic`, coerente com
 * `computeOrgStatus`) — sem erro e sem revelar qual dado bateu. E-mail ja cadastrado: `P2002` propaga (a action devolve a mensagem generica).
 */
export interface CreateTrialAccountInput {
  name: string;
  email: string;
  passwordHash: string;
  document: ParsedDocument;
  /** IP acima do teto/dominio descartavel: cria a conta sem trial. */
  denyTrial?: boolean;
  now?: Date;
}

export interface CreateTrialAccountResult {
  userId: string;
  orgId: string;
  trialGranted: boolean;
  trialEndsAt: Date;
}

export async function createTrialAccount(input: CreateTrialAccountInput): Promise<CreateTrialAccountResult> {
  const now = input.now ?? new Date();
  const first = input.name.trim().split(/\s+/)[0] || "Minha";
  const orgName = `Empresa de ${first}`.slice(0, 120);
  const freePlan = await prisma.plan.findUniqueOrThrow({ where: { key: "free" }, select: { id: true } });
  const orgId = randomUUID();
  let slugAttempt = 0;
  for (;;) {
    const slug = await uniqueOrgSlug(orgName, slugAttempt);
    try {
      return await prisma.$transaction(async (tx) => {
        // SPEC-055 (D-055-3): cadastro self-service nasce NAO verificado (o default do banco e "verificado").
        const user = await tx.user.create({ data: { name: input.name, email: input.email, role: "provider", passwordHash: input.passwordHash, emailVerifiedAt: null }, select: { id: true } });
        const claimedAllNew = await claimTrial(tx, input.email, input.document);
        const trialGranted = claimedAllNew && !input.denyTrial;
        const trialEndsAt = trialGranted ? new Date(now.getTime() + TRIAL_MS) : now;
        const sub = { status: "trialing" as const, pastDueSince: null, cancelAtPeriodEnd: false, currentPeriodEnd: null, trialEndsAt };
        const orgStatus = computeOrgStatus(sub, now);
        await tx.organization.create({ data: { id: orgId, name: orgName, slug, status: orgStatus, suspendedReason: orgStatus === "suspended" ? "automatic" : null } });
        await tx.membership.create({ data: { userId: user.id, orgId, orgRole: "owner" } });
        await tx.subscription.create({ data: { orgId, planId: freePlan.id, status: "trialing", cadence: "monthly", trialEndsAt } });
        await tx.user.update({ where: { id: user.id }, data: { lastOrgId: orgId } });
        await recordOrgAudit(tx, { orgId, actorUserId: user.id, action: "org_created", meta: { via: "signup" } });
        return { userId: user.id, orgId, trialGranted, trialEndsAt };
      });
    } catch (e) {
      // Colisao de slug (corrida): tenta de novo com sufixo; qualquer outro P2002 (e-mail ja cadastrado) propaga.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && String(JSON.stringify(e.meta ?? {})).includes("slug") && slugAttempt < 3) {
        slugAttempt++;
        continue;
      }
      throw e;
    }
  }
}
