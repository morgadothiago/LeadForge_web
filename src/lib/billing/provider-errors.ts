import { isAppError } from "@/lib/errors";

/**
 * SPEC-063 (D-063-24) — erro do PROVEDOR que o usuario NAO causou (config/credencial/contrato nosso) vira "pagamento indisponivel"
 * (com log de diagnostico), em vez de "AbacatePay rejeitou os dados enviados" (que culpa o usuario).
 * - `upstream`/`network`/`timeout`/`config`: sempre.
 * - `validation`/`unauthorized`/`forbidden`/`not_found`/`conflict`: so quando vieram de uma RESPOSTA HTTP do provedor (`status` presente);
 *   erros locais do adapter (ex.: "plano sem cobranca anual", "plano nao encontrado") mantem a propria mensagem.
 * - `rate_limited` segue como hoje (mensagem propria com tempo de espera).
 */
const ALWAYS = new Set(["upstream", "network", "timeout", "config"]);
const WHEN_FROM_PROVIDER = new Set(["validation", "unauthorized", "forbidden", "not_found", "conflict"]);

export function isBillingUnavailableError(e: unknown): boolean {
  if (!isAppError(e)) return false;
  return ALWAYS.has(e.code) || (WHEN_FROM_PROVIDER.has(e.code) && e.status !== undefined);
}
