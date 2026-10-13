import { requireSession } from "@/lib/notifications/http";
import { fail, tooMany } from "@/lib/mobile/http";
import { redisHit } from "@/lib/rate-limit/redis";
import { getEntitlements, hasFeature, requiredPlanName } from "@/lib/billing/entitlements";
import { prisma } from "@/lib/prisma";

/**
 * SPEC-068a: guarda dos Route Handlers de leitura da caixa. Sessão (cookie) obrigatória: 401 sem sessão; `platform_admin` (sem org) não acessa
 * caixas de clientes (403); trial expirado = 403 `trial_expired` (via `requireSession`). Rate limit por usuário (Redis com fallback em memória).
 */
export const READ_LIMIT_PER_MINUTE = 120;
const WINDOW_MS = 60_000;
const MAX_KEYS = 5_000;
const hits = new Map<string, { count: number; resetAt: number }>();

export function _resetInboxReadLimit(): void {
  hits.clear();
}

function memoryHit(key: string, max: number, now: number): number | null {
  let e = hits.get(key);
  if (!e || e.resetAt <= now) {
    if (!e && hits.size >= MAX_KEYS) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      if (hits.size >= MAX_KEYS) return null; // sem espaço: não derruba o polling legítimo
    }
    e = { count: 0, resetAt: now + WINDOW_MS };
    hits.set(key, e);
  }
  e.count++;
  return e.count > max ? Math.max(1, Math.ceil((e.resetAt - now) / 1000)) : null;
}

export async function readRateLimitWait(userId: string, now = Date.now()): Promise<number | null> {
  const viaRedis = await redisHit("inbox-read", userId, READ_LIMIT_PER_MINUTE, WINDOW_MS);
  return viaRedis !== undefined ? viaRedis : memoryHit(userId, READ_LIMIT_PER_MINUTE, now);
}

export async function inboxReadGuard(): Promise<{ orgId: string; userId: string } | Response> {
  const a = await requireSession();
  if (a instanceof Response) return a;
  if (!a.orgId || a.platformRole !== "provider") return fail(403, "forbidden", "Sem permissão.");
  const wait = await readRateLimitWait(a.id);
  if (wait !== null) return tooMany(wait);
  // SPEC-069b: leitura da caixa e a ultima coisa que cai (so some se o plano/override nao inclui `inbox.read`; downgrade/past_due/expirado continuam lendo).
  if (!hasFeature(await getEntitlements(prisma, a.orgId), "inbox.read")) return fail(403, "plan_feature_locked", `Caixa de atendimento indisponível no plano atual. Disponível a partir do plano ${requiredPlanName("inbox.read")}.`);
  return { orgId: a.orgId, userId: a.id };
}

export const conversationNotFound = (): Response => fail(404, "not_found", "Conversa não encontrada.");

/** Inteiro positivo opcional (limit). `undefined` = ausente; `null` = inválido. */
export function parseLimit(raw: string | null): number | undefined | null {
  if (raw === null) return undefined;
  if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1) return null;
  return Number(raw);
}
