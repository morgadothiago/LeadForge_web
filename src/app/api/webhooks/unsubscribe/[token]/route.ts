import { getClientIp } from "@/lib/auth/client-ip";
import { rateLimitRetrySeconds } from "@/lib/channels/unsubscribe-rate-limit";
import { tooManyRequests } from "@/lib/http";
import { unsubscribeLead, verifyUnsubscribeToken } from "@/lib/channels/unsubscribe";

/**
 * Rota PÚBLICA (isenta do proxy: matcher exclui /api/webhooks). GET = página de confirmação SEM efeito colateral
 * (scanners de e-mail pré-carregam links); POST (botão ou one-click RFC 8058) efetiva o descadastro. Idempotente.
 * Rate limit em memória: por IP (só com proxy confiável) + por token; sem IP confiável, só por token + teto global — por processo, reinicia no deploy.
 */
const HEAD = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };

function page(title: string, msg: string, form?: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="font-family:sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${msg}</p>${form ?? ""}</body></html>`;
}
const html = (status: number, title: string, msg: string, form?: string, extra: Record<string, string> = {}) =>
  new Response(page(title, msg, form), { status, headers: { ...HEAD, ...extra } });

function guard(req: Request, token: string): Response | null {
  const retry = rateLimitRetrySeconds(getClientIp(req.headers), token);
  return retry === null ? null : tooManyRequests(retry);
}
const invalid = () => html(400, "Link inválido", "Este link de descadastro é inválido ou expirou.");

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await ctx.params;
  const limited = guard(req, token);
  if (limited) return limited;
  if (!verifyUnsubscribeToken(token)) return invalid();
  return html(
    200,
    "Descadastrar e-mails",
    "Confirme abaixo para deixar de receber nossos e-mails.",
    `<form method="post"><button type="submit" style="padding:.6rem 1.2rem">Confirmar descadastro</button></form>`,
  );
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await ctx.params;
  const limited = guard(req, token);
  if (limited) return limited;
  const leadId = verifyUnsubscribeToken(token);
  if (!leadId) return invalid();
  if (!(await unsubscribeLead(leadId))) return invalid();
  return html(200, "Descadastro concluído", "Você não receberá mais e-mails nossos.");
}
