import { createHash, timingSafeEqual } from "node:crypto";
import { tooManyRequests } from "@/lib/http";
import { safeErrorForLog } from "@/lib/errors";
import { getCronSecret } from "./config";
import { processAgentQueue } from "@/lib/agents/queue";
import { runDailySearch } from "@/lib/lead-search/run";
import { runTick, type TickSummary } from "./run-tick";

/**
 * Handler do /api/cron/tick (SPEC-013). Autenticado SÓ por `Authorization: Bearer <CRON_SECRET>` (sem sessão de usuário:
 * não usa requireUser). O segredo e o header Authorization nunca são logados nem devolvidos.
 */

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (body: unknown, status: number, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

/** 401 idêntico (corpo e headers) para ausente/malformado/errado. */
export const unauthorized = (): Response => json({ error: "unauthorized", message: "Não autorizado." }, 401, { "WWW-Authenticate": "Bearer" });
export const notConfigured = (): Response => json({ error: "not_configured", message: "Agendador não configurado." }, 503);
export const methodNotAllowed = (): Response => json({ error: "method_not_allowed", message: "Método não permitido." }, 405, { Allow: "GET, POST" });

const sha = (s: string) => createHash("sha256").update(s).digest();
/** Tempo constante: compara os SHA-256 (tamanho fixo, sem vazar o comprimento do segredo). */
export function secretsMatch(presented: string, expected: string): boolean {
  return timingSafeEqual(sha(presented), sha(expected));
}

export function bearerToken(req: Request): string | null {
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
  return m ? m[1] : null;
}

// Rate limit só de tentativas INVÁLIDAS: uma única chave global (nunca uma chave por segredo forjado => memória constante).
// Credencial válida NUNCA é bloqueada por ruído (não dá para trancar o cron legítimo com lixo).
const INVALID = { windowMs: 60_000, max: 20 };
let bucket = { count: 0, resetAt: 0 };
export const _resetCronRateLimit = (): void => void (bucket = { count: 0, resetAt: 0 });
function invalidRetry(now = Date.now()): number | null {
  if (bucket.resetAt <= now) bucket = { count: 0, resetAt: now + INVALID.windowMs };
  bucket.count++;
  return bucket.count > INVALID.max ? Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) : null;
}

export interface CronDeps {
  run?: (now: Date) => Promise<TickSummary>;
  secret?: string | null;
}

export async function handleCronTick(req: Request, deps: CronDeps = {}): Promise<Response> {
  const secret = deps.secret !== undefined ? deps.secret : getCronSecret();
  if (!secret) return notConfigured();
  const token = bearerToken(req);
  if (!token || !secretsMatch(token, secret)) {
    const wait = invalidRetry();
    return wait !== null ? tooManyRequests(wait) : unauthorized();
  }
  try {
    const s = await (deps.run ?? ((now: Date) => runTick(now)))(new Date());
    // SPEC-019 Fila C: tarefas de agentes (falha isolada: nunca derruba a resposta do tick). Só com o `run` padrão.
    let agents: unknown = undefined;
    if (!deps.run) agents = await processAgentQueue().catch((e) => (console.error("[cron/tick] agentes:", safeErrorForLog(e)), { error: "falha" }));
    // SPEC-015: busca diária de leads (desligada por padrão; 1 execução agendada/campanha/dia; falha isolada).
    let search: unknown = undefined;
    if (!deps.run) search = await runDailySearch().then((r) => (r.length ? r : undefined)).catch((e) => (console.error("[cron/tick] busca:", safeErrorForLog(e)), { error: "falha" }));
    return json({ ...s, ...(agents ? { agents } : {}), ...(search ? { search } : {}) }, 200);
  } catch (e) {
    console.error("[cron/tick] erro:", safeErrorForLog(e));
    return json({ error: "internal", message: "Falha ao executar a rodada." }, 500);
  }
}
