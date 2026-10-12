import type { SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { IS_SHELL, NOT_SHELL } from "@/lib/billing/shell";
import type { PlatformRole } from "./session-token";

/**
 * SPEC-062 (D-062-6) — estado do usuario DERIVADO (nunca armazenado). `resolveAccountStage` e pura (testavel por
 * tabela); `resolveStageRoute` e a UNICA fonte de "para onde mandar" (landing, login, signup, `(app)/layout`, retorno).
 */
export type AccountStage = "sem_plano" | "aguardando_pagamento" | "pago_sem_org" | "membro" | "dono" | "membro_pago_sem_org" | "admin";

export interface AccountStageInput {
  platformRole: PlatformRole;
  /** Tem Membership em organizacao REAL (nao casca). */
  hasOrg: boolean;
  /** E owner de alguma organizacao real. */
  isOwner: boolean;
  /** Casca do usuario (se houver) e o status da assinatura dela. */
  shell: { subscriptionStatus: SubscriptionStatus | null } | null;
}

export function resolveAccountStage(i: AccountStageInput): AccountStage {
  if (i.platformRole === "platform_admin") return "admin";
  const paidShell = i.shell?.subscriptionStatus === "active";
  if (paidShell) return i.hasOrg ? "membro_pago_sem_org" : "pago_sem_org";
  if (i.hasOrg) return i.isOwner ? "dono" : "membro";
  if (i.shell?.subscriptionStatus === "incomplete") return "aguardando_pagamento";
  return "sem_plano";
}

export function resolveStageRoute(stage: AccountStage): string {
  switch (stage) {
    case "admin":
      return "/admin/organizacoes";
    case "membro":
    case "dono":
    case "membro_pago_sem_org":
      return "/dashboard";
    case "pago_sem_org":
      return "/organizacao/nova";
    case "aguardando_pagamento":
      return "/assinar/retorno";
    case "sem_plano":
      return "/assinar";
  }
}

export interface LoadedAccountStage {
  stage: AccountStage;
  redirectTo: string;
  /** Tem casca paga esperando nome (D-062-19): a UI mostra o banner "Finalize sua organizacao" para quem ja tem org. */
  pendingSetup: boolean;
}

/** Le o estado do usuario no banco (membership/casca/assinatura) e aplica a funcao pura. */
export async function loadAccountStage(userId: string, platformRole: PlatformRole): Promise<LoadedAccountStage> {
  if (platformRole === "platform_admin") {
    return { stage: "admin", redirectTo: resolveStageRoute("admin"), pendingSetup: false };
  }
  const [real, shellMembership] = await Promise.all([
    prisma.membership.findMany({ where: { userId, org: NOT_SHELL }, select: { orgRole: true } }),
    prisma.membership.findFirst({
      where: { userId, orgRole: "owner", org: IS_SHELL },
      orderBy: { createdAt: "asc" },
      select: { org: { select: { subscription: { select: { status: true } } } } },
    }),
  ]);
  const shell = shellMembership ? { subscriptionStatus: shellMembership.org.subscription?.status ?? null } : null;
  const stage = resolveAccountStage({ platformRole, hasOrg: real.length > 0, isOwner: real.some((m) => m.orgRole === "owner"), shell });
  return { stage, redirectTo: resolveStageRoute(stage), pendingSetup: shell?.subscriptionStatus === "active" };
}

/** Destino pos-login/landing/signup (substitui `homeRouteFor` fixo): admin, com org, ou rota do estado. */
export async function resolveHomeRoute(userId: string, platformRole: PlatformRole): Promise<string> {
  return (await loadAccountStage(userId, platformRole)).redirectTo;
}

/**
 * Destino de quem JA tem sessao (landing/login/signup/layout). Caso inconsistente (provider com Membership real mas sessao
 * sem org: so um JWT antigo/anomalo, pois toda acao que cria Membership reemite a sessao): devolve `null` — quem chama
 * NAO redireciona para o app (evita laco) e deixa o usuario autenticar de novo, o que reemite a sessao com a org.
 */
export async function resolveSessionHomeRoute(user: { id: string; platformRole: PlatformRole; orgId: string | null }): Promise<string | null> {
  const { stage, redirectTo } = await loadAccountStage(user.id, user.platformRole);
  if (stage === "admin") return redirectTo;
  const needsOrgInSession = redirectTo === "/dashboard";
  if (needsOrgInSession && !user.orgId) return null;
  return redirectTo;
}
