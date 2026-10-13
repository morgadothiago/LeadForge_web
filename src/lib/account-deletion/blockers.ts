import type { Prisma, PrismaClient } from "@prisma/client";
import { isFreePlanKey } from "@/lib/billing/plan-catalog";
import { lockOrg } from "@/lib/org/guards";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * SPEC-054a (D-054-3) — o que IMPEDE a exclusao. Codigo tipado (estavel, usado pelo frontend 054b) + mensagem PT-BR.
 * - `active_subscription`: o usuario e o UNICO membro da org e ha assinatura nao cancelada (trial/ativa/em atraso sem
 *   `cancelAtPeriodEnd`): cancelar primeiro (SPEC-053). Org com assinatura ja cancelada/agendada segue o fluxo 053/033
 *   (efetivacao -> 90 dias de retencao -> expurgo) sem reimplementar nada aqui.
 * - `org_without_subscription`: o usuario e o UNICO membro da org e ela NAO tem Subscription: nao ha fluxo 053/033 que a
 *   encerre; excluir deixaria a org ativa e sem owner (nunca org sem owner). Contatar o suporte.
 * - `last_owner_with_members`: unico owner de org com outros membros: promover outro owner antes (SPEC-049; nunca org sem owner).
 * - `platform_admin`: admin da plataforma nao se exclui por este fluxo.
 * - `no_password`: sem senha definida nao ha como reautenticar.
 */
export type DeletionBlockerCode = "active_subscription" | "org_without_subscription" | "last_owner_with_members" | "platform_admin" | "no_password";

export interface DeletionBlocker {
  code: DeletionBlockerCode;
  message: string;
  orgId?: string;
  orgName?: string;
}

const ACTIVE_SUB_STATUSES = ["trialing", "active", "past_due"] as const;

export const BLOCKER_MESSAGES = {
  active_subscription: (org: string) => `A organização "${org}" tem uma assinatura ativa e você é o único membro. Cancele a assinatura em Configurações > Assinatura antes de excluir sua conta.`,
  org_without_subscription: (org: string) => `A organização "${org}" não tem assinatura registrada e você é o único membro; excluir sua conta deixaria a organização sem responsável. Contate o suporte antes de excluir sua conta.`,
  last_owner_with_members: (org: string) => `Você é o único proprietário da organização "${org}", que tem outros membros. Promova outro membro a proprietário (ou remova os demais) antes de excluir sua conta.`,
  platform_admin: "Contas de administrador da plataforma não podem ser excluídas por aqui. Contate o suporte.",
  no_password: "Sua conta não tem senha definida. Redefina a senha (\"Esqueci minha senha\") antes de excluir a conta.",
} as const;

/** Lista os bloqueios do usuario. Leitura pura (chamar dentro de tx apos `lockOrg` para decisao definitiva). */
export async function findDeletionBlockers(db: Db, userId: string): Promise<DeletionBlocker[]> {
  const out: DeletionBlocker[] = [];
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, passwordHash: true } });
  if (!user) return out;
  if (user.role === "platform_admin") out.push({ code: "platform_admin", message: BLOCKER_MESSAGES.platform_admin });
  if (!user.passwordHash) out.push({ code: "no_password", message: BLOCKER_MESSAGES.no_password });

  const memberships = await db.membership.findMany({
    where: { userId },
    select: { orgId: true, orgRole: true, org: { select: { name: true, subscription: { select: { status: true, cancelAtPeriodEnd: true, trialEndsAt: true, plan: { select: { key: true } } } } } } },
    orderBy: { orgId: "asc" },
  });
  for (const m of memberships) {
    const others = await db.membership.count({ where: { orgId: m.orgId, userId: { not: userId } } });
    if (others === 0) {
      const sub = m.org.subscription;
      if (!sub) {
        out.push({ code: "org_without_subscription", message: BLOCKER_MESSAGES.org_without_subscription(m.org.name), orgId: m.orgId, orgName: m.org.name });
      } else if (sub.status === "trialing" && (isFreePlanKey(sub.plan.key) || !sub.trialEndsAt || sub.trialEndsAt.getTime() <= Date.now())) {
        // SPEC-065 (D-065-24 + QA 065a): trial Free, ou trial (legado) EXPIRADO — nao ha o que cancelar (e cancelar fica bloqueado) — nao bloqueia a exclusao — nao bloqueia a exclusao (a purga encerra a organizacao Free).
      } else if ((ACTIVE_SUB_STATUSES as readonly string[]).includes(sub.status) && !sub.cancelAtPeriodEnd) {
        out.push({ code: "active_subscription", message: BLOCKER_MESSAGES.active_subscription(m.org.name), orgId: m.orgId, orgName: m.org.name });
      }
    } else if (m.orgRole === "owner") {
      const otherOwners = await db.membership.count({ where: { orgId: m.orgId, orgRole: "owner", userId: { not: userId } } });
      if (otherOwners === 0) out.push({ code: "last_owner_with_members", message: BLOCKER_MESSAGES.last_owner_with_members(m.org.name), orgId: m.orgId, orgName: m.org.name });
    }
  }
  return out;
}

/** Trava (lockOrg, ordem estavel por id => sem deadlock) todas as orgs do usuario. Dentro de `$transaction`. */
export async function lockUserOrgs(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const ms = await tx.membership.findMany({ where: { userId }, select: { orgId: true }, orderBy: { orgId: "asc" } });
  for (const m of ms) await lockOrg(tx, m.orgId);
}
