/**
 * IP do cliente para rate limit. Por padrão IGNORA x-forwarded-for (forjável). Só confia no cabeçalho
 * nomeado em TRUSTED_PROXY_IP_HEADER (ex.: x-real-ip), que o proxy/CDN de confiança DEVE sobrescrever.
 * Sem a env: "unknown" (o limite por e-mail continua protegendo).
 */
export function getClientIp(h: Headers): string {
  const name = process.env.TRUSTED_PROXY_IP_HEADER?.trim().toLowerCase();
  if (!name) return "unknown";
  const v = h.get(name)?.split(",")[0]?.trim();
  return v && v.length <= 64 ? v : "unknown";
}

let warnedNoTrustedHeader = false;

/**
 * Chave de IP para rate limit em memória (SPEC-049 D-049-14). Igual a `getClientIp`, mas em PRODUÇÃO sem IP confiável
 * (TRUSTED_PROXY_IP_HEADER ausente/inválido) NÃO devolve "unknown": um bucket global compartilhado deixaria um único
 * atacante bloquear todos os usuários (DoS). Devolve uma chave única por requisição (o limite por IP fica inoperante —
 * os limites por usuário/e-mail/token continuam valendo) e avisa uma vez no log. Fora de produção mantém "unknown".
 */
export function getClientIpKey(h: Headers): string {
  const ip = getClientIp(h);
  if (ip !== "unknown" || process.env.NODE_ENV !== "production") return ip;
  if (!warnedNoTrustedHeader) {
    warnedNoTrustedHeader = true;
    console.warn("[rate-limit] TRUSTED_PROXY_IP_HEADER ausente em producao: limite por IP desativado (defina o cabecalho do proxy).");
  }
  return `unknown:${crypto.randomUUID()}`;
}
