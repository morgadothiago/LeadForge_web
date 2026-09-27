import type { OrgStatus, Subscription, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * SPEC-033 — ÚNICO lugar que traduz `Subscription.status` em `Organization.status` (D-33-3/D-33-4).
 * Fonte da verdade para o gate de billing: o cron (SPEC-030, `runTick`) e o guard de escrita
 * (`requireActiveProviderOrg`, `src/lib/auth/require-admin.ts`) só leem `Organization.status` — quem
 * decide o valor é sempre esta função, nunca um `update` solto em outro arquivo.
 *
 * Mapeamento:
 * - `trialing`/`active`               -> `active`
 * - `past_due` dentro do grace (7d)   -> `active` (com aviso; banner fica para SPEC-034)
 * - `past_due` fora do grace          -> `suspended`
 * - `canceled`/`incomplete`           -> `suspended` (soft-block imediato ao cancelar, D-33-4; dado nunca é apagado aqui)
 */
export const PAST_DUE_GRACE_MS = 7 * 24 * 3600_000;
export const TRIAL_DAYS = 14;
/** D-33-4: retenção de 90 dias após cancelamento, depois o job de expurgo (`purge.ts`) anonimiza o dado. */
export const CANCEL_RETENTION_MS = 90 * 24 * 3600_000;

export function computeOrgStatus(sub: Pick<Subscription, "status" | "pastDueSince"> | null, now: Date): OrgStatus {
  if (!sub) return "active"; // org sem Subscription ainda (não deveria acontecer fora de testes/backfill) — nunca bloqueia por omissão.
  switch (sub.status) {
    case "trialing":
    case "active":
      return "active";
    case "past_due": {
      const since = sub.pastDueSince?.getTime() ?? now.getTime();
      return now.getTime() - since < PAST_DUE_GRACE_MS ? "active" : "suspended";
    }
    case "canceled":
    case "incomplete":
      return "suspended";
    default:
      return "suspended";
  }
}

/**
 * Recalcula `Organization.status` para TODAS as orgs com `Subscription` cujo status mapeado mudou
 * (cobre a expiração do grace period de `past_due`, que é dependente do tempo, não de um evento).
 * Chamada pelo tick (SPEC-013/030) antes de selecionar as orgs ativas da rodada; nunca lança (falha
 * isolada não derruba o scheduler).
 *
 * SPEC-039 (correção QA): esta função é o ÚNICO lugar que sabe com certeza que uma transição para
 * `suspended` foi causada pelo mecanismo AUTOMÁTICO (nunca por ação do `platform_admin`) — por isso é
 * aqui, e só aqui, que `Organization.suspendedReason` é gravado como `"automatic"`. Quando a org já
 * está `suspended` (`next === s.org.status`, sem mudança), o `suspendedReason` existente NÃO é
 * tocado — se ele já é `"manual"` (suspensão feita por `suspendOrganization`, SPEC-031), permanece
 * `"manual"` mesmo que a `Subscription` também esteja em `past_due` com grace expirado por coincidência
 * (D-039-1: a ação manual do admin nunca deve "virar" automática por baixo).
 */
export async function syncOrgStatuses(now: Date): Promise<number> {
  const subs = await prisma.subscription.findMany({
    select: { orgId: true, status: true, pastDueSince: true, org: { select: { status: true } } },
  });
  let changed = 0;
  for (const s of subs) {
    const next = computeOrgStatus(s, now);
    if (next !== s.org.status) {
      await prisma.organization
        .update({ where: { id: s.orgId }, data: { status: next, suspendedReason: next === "suspended" ? "automatic" : null } })
        .catch(() => {});
      changed++;
    }
  }
  return changed;
}

/** Reexportado para os testes/seed (evita magic string duplicada). */
export type { SubscriptionStatus };
