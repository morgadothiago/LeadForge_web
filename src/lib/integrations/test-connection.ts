import { getWhatsAppProvider } from "@/lib/whatsapp/provider";
import { findIntegrationConfig } from "./config";
import { assertAllowedHost, parseIntegrationUrl, pinnedAgents } from "./url-guard";
import { createOpenAICompatClient } from "@/lib/agents/provider";
import { AppError, safeErrorForLog } from "@/lib/errors";
import type { IntegrationKindName } from "./types";
import { SlidingLimiter } from "./rate-limit";

export interface ConnectionTestResult {
  /** false = ainda não há cliente para esta integração (só o formato foi validado). */
  available: boolean;
  ok: boolean;
  message: string;
  retryAfterSeconds?: number;
}

let deadlineMs = 15_000;
/** Só testes. */
export function _setTestDeadline(ms: number | null): void {
  deadlineMs = ms ?? 15_000;
}

const userLimiter = new SlidingLimiter(5, 60_000);
const integrationLimiter = new SlidingLimiter(8, 60_000);
const saveLimiter = new SlidingLimiter(10, 60_000);

/**
 * Limites em memória (por processo): máx. 5 testes/min por usuário E 8/min por integração (vários admins não somam).
 * Devolve segundos até liberar (0 = liberado; registra a tentativa).
 */
export function consumeTestQuota(userId: string, integrationId?: string, now = Date.now()): number {
  const w = Math.max(userLimiter.peek(userId, now), integrationId ? integrationLimiter.peek(`i:${integrationId}`, now) : 0);
  if (w > 0) return w;
  userLimiter.hit(userId, now);
  if (integrationId) integrationLimiter.hit(`i:${integrationId}`, now);
  return 0;
}
/** saveIntegration resolve DNS: máx. 10 salvamentos/min por usuário. */
export function consumeSaveQuota(userId: string, now = Date.now()): number {
  return saveLimiter.hit(userId, now);
}
export function _resetTestQuota(): void {
  userLimiter.clear();
  integrationLimiter.clear();
  saveLimiter.clear();
}

function withDeadline<T>(p: Promise<T>): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new AppError({ code: "timeout", userMessage: "A integração demorou demais para responder.", retryable: true })), deadlineMs);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

/** SPEC-036 (D-36-5): `GET {baseUrl}/models` com timeout curto, sem retry. Sem URL base (Claude) => indisponível. */
async function runLlmConnectionTest(orgId: string): Promise<ConnectionTestResult> {
  try {
    const cfg = await findIntegrationConfig(orgId, "llm");
    if (!cfg?.baseUrl) return { available: false, ok: false, message: "Teste de conexão indisponível para o Claude (sem URL base). O formato foi validado." };
    const u = parseIntegrationUrl(cfg.baseUrl);
    const { ip, family } = await assertAllowedHost(u.hostname, cfg.allowPrivateHost);
    const client = createOpenAICompatClient(u.url, cfg.reveal() || undefined, undefined, pinnedAgents(ip, family));
    client.defaults.timeout = Math.min(deadlineMs, 10_000);
    await withDeadline(client.get("/models"));
    return { available: true, ok: true, message: "Conexão com o provedor de LLM OK." };
  } catch (e) {
    if (e instanceof AppError) {
      if (cfgPrivateNetworkError(e)) {
        console.error("[integrations] teste LLM falhou (rede):", safeErrorForLog(e));
        return { available: true, ok: false, message: GENERIC_CONNECT_MESSAGE };
      }
      return { available: true, ok: false, message: e.userMessage, ...(e.retryAfterSeconds != null ? { retryAfterSeconds: e.retryAfterSeconds } : {}) };
    }
    console.error("[integrations] teste LLM falhou:", safeErrorForLog(e));
    return { available: true, ok: false, message: "Falha ao testar a conexão." };
  }
}
/** Falha de rede sem resposta HTTP (não distingue DNS/recusa/timeout: evita oráculo de rede interna). */
const cfgPrivateNetworkError = (e: AppError): boolean => e.status == null && e.code !== "rate_limited" && e.code !== "validation" && e.code !== "config";

/** Nunca lança por falha do provider: devolve resultado PT-BR (a mensagem vem de AppError.userMessage, sem chave/corpo). */
export const GENERIC_CONNECT_MESSAGE = "Não foi possível conectar ao servidor informado. Verifique o endereço, a porta e se o serviço está no ar.";

/**
 * `privateTarget` (allowPrivateHost=true): sem distinguir DNS inexistente / conexão recusada / timeout (evita oráculo de rede interna);
 * o detalhe fica só no log seguro. Resposta HTTP do servidor alcançado (status 401/403/404/5xx/429) continua informando: o admin precisa saber que a chave foi rejeitada.
 */
export async function runConnectionTest(orgId: string, integration: IntegrationKindName, opts: { privateTarget?: boolean } = {}): Promise<ConnectionTestResult> {
  if (integration === "llm") return runLlmConnectionTest(orgId);
  if (integration !== "evolution") {
    return { available: false, ok: false, message: "Teste de conexão indisponível para esta integração. O formato foi validado." };
  }
  try {
    const provider = getWhatsAppProvider(orgId, "evolution", { timeoutMs: Math.min(deadlineMs, 10_000), retry: false });
    if (!provider.ping) return { available: false, ok: false, message: "Teste de conexão indisponível para este provider." };
    await withDeadline(provider.ping());
    return { available: true, ok: true, message: "Conexão com a Evolution OK." };
  } catch (e) {
    if (e instanceof AppError) {
      if (opts.privateTarget && e.status == null && e.code !== "rate_limited" && e.code !== "validation") {
        console.error("[integrations] teste falhou (rede):", safeErrorForLog(e));
        return { available: true, ok: false, message: GENERIC_CONNECT_MESSAGE };
      }
      return { available: true, ok: false, message: e.userMessage, ...(e.retryAfterSeconds != null ? { retryAfterSeconds: e.retryAfterSeconds } : {}) };
    }
    console.error("[integrations] teste falhou:", safeErrorForLog(e));
    return { available: true, ok: false, message: "Falha ao testar a conexão." };
  }
}
