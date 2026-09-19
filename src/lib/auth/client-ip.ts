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
