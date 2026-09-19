/** O token do webhook vai no caminho da URL: qualquer string que vá a log/erro/banco passa por aqui. */
export function redactWebhookToken(input: string): string {
  return input.replace(/(\/api\/webhooks\/whatsapp\/)[^/?#\s"']+/gi, "$1[REDACTED]");
}

/** Últimos 4 caracteres, para exibição. */
export function tokenHint(token: string): string {
  return `…${token.slice(-4)}`;
}

/** URL sem o segredo (para retornar ao cliente sem expor o token completo). */
export function maskedWebhookUrl(fullUrl: string, token: string): string {
  return fullUrl.replace(encodeURIComponent(token), tokenHint(token));
}
