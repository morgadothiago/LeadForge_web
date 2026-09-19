const SENSITIVE = /^(authorization|proxy-authorization|apikey|api-key|x-api-key|cookie|set-cookie|password|senha|token|secret)$/i;

/** Copia rasa de headers/objeto com valores sensíveis mascarados (para logs). */
export function redactHeaders(h: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!h || typeof h !== "object") return out;
  const src = typeof (h as { toJSON?: unknown }).toJSON === "function" ? (h as { toJSON(): object }).toJSON() : h;
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) out[k] = SENSITIVE.test(k) ? "[REDACTED]" : v;
  return out;
}

/** Remove credenciais de userinfo e query params sensíveis de uma URL. */
export function redactUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url, "http://placeholder.local");
    u.username = "";
    u.password = "";
    for (const k of [...u.searchParams.keys()]) if (SENSITIVE.test(k)) u.searchParams.set(k, "[REDACTED]");
    const isAbs = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
    return isAbs ? u.toString() : u.pathname + u.search;
  } catch {
    return "[url]";
  }
}
