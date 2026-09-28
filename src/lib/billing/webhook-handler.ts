import { bearerToken, secretsMatch } from "@/lib/scheduler/cron-endpoint";
import { AppError, safeErrorForLog } from "@/lib/errors";
import { getMockWebhookSecret } from "./config";
import { getPaymentProvider } from "./provider-factory";
import { processBillingEvent } from "./process-event";
import type { PaymentProvider } from "./provider";

/**
 * Receiver do webhook de billing (SPEC-033). Rota PÚBLICA — autenticação é a assinatura HMAC do provedor
 * (`verifyWebhookSignature`; mesmo cuidado documentado para o webhook do WhatsApp em SPEC-012/017). Em
 * modo mock (default, D-33-5) não há chamador HTTP externo real (o checkout mock já dispara o evento
 * internamente, `providers/mock.ts`); esta rota segue existindo para exercitar o MESMO parser/handler
 * (testável sem depender do checkout) e para já estar pronta quando `PAYMENT_PROVIDER=stripe` ativar.
 *
 * QA fix (achado crítico, rodada 2): `MockPaymentProvider.verifyWebhookSignature` sempre retorna `true`
 * (não há gateway externo a validar em modo mock) — sozinho isso deixaria a rota HTTP aberta a qualquer
 * chamador não autenticado forjando `orgId`. Quando o provider ativo é `mock`, exige-se ADICIONALMENTE
 * `Authorization: Bearer <MOCK_WEBHOOK_SECRET>` (mesmo padrão de `CRON_SECRET`, ver `billing/config.ts`)
 * antes de sequer chamar `parseWebhookEvent`/`processBillingEvent`. Ausente/curto => 503 (nunca aberta).
 */

const MAX_BODY_BYTES = 1_000_000;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const unauthorized = (): Response => json(401, { error: "unauthorized", message: "Não autorizado." });
const notConfigured = (): Response => json(503, { error: "not_configured", message: "Webhook de billing não configurado." });
const ok = (result: string): Response => json(200, { ok: true, result });

async function readBodyLimited(request: Request, max: number): Promise<Uint8Array | null> {
  if (Number(request.headers.get("content-length") ?? 0) > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export interface HandlerOptions {
  now?: Date;
  /** Testes: provider injetado (default: getPaymentProvider(), respeita PAYMENT_PROVIDER do env). */
  provider?: PaymentProvider;
}

export async function handleBillingWebhook(request: Request, opts: HandlerOptions = {}): Promise<Response> {
  const now = opts.now ?? new Date();
  try {
    const provider = opts.provider ?? getPaymentProvider();

    // QA fix (achado crítico): em modo mock, `verifyWebhookSignature` sempre `true` — exige um segredo
    // compartilhado ADICIONAL (nunca controlável pelo chamador) antes de tocar no corpo/evento.
    if (provider.name === "mock") {
      const secret = getMockWebhookSecret();
      if (!secret) return notConfigured();
      const token = bearerToken(request);
      if (!token || !secretsMatch(token, secret)) return unauthorized();
    }

    const bytes = await readBodyLimited(request, MAX_BODY_BYTES);
    if (!bytes) return json(413, { error: "payload_too_large", message: "Corpo da requisição grande demais." });
    const rawBody = new TextDecoder().decode(bytes);
    // QA fix (SPEC-047, D-047-2): o AbacatePay autentica por `?webhookSecret=` na URL de callback (único
    // segredo por conta), enquanto o Stripe continua no header `stripe-signature` — que tem precedência
    // quando presente (nada muda pro Stripe). O fallback só existe se o header estiver ausente; a URL
    // completa (que carrega o segredo) nunca é logada, só mensagens de erro sem a URL.
    const signature = request.headers.get("stripe-signature") ?? new URL(request.url).searchParams.get("webhookSecret");
    if (!provider.verifyWebhookSignature(rawBody, signature)) return unauthorized();

    let event;
    try {
      event = provider.parseWebhookEvent(rawBody);
    } catch (e) {
      if (e instanceof AppError && e.code === "validation") return json(400, { error: "invalid_payload", message: "Payload de webhook inválido." });
      throw e;
    }
    if (!event) return ok("ignored");

    const result = await processBillingEvent(event, now);
    if (result === "org_not_found" || result === "plan_not_found") {
      // Nunca 500: evento reconhecível mas referenciando algo que não existe (ex.: org apagada) — logado, sem retry infinito do provedor.
      console.error(`[billing-webhook] ${result} (eventId=${event.eventId})`);
      return ok(result);
    }
    return ok(result);
  } catch (e) {
    console.error("[billing-webhook] erro:", safeErrorForLog(e));
    return json(500, { error: "internal_error", message: "Não foi possível processar o webhook." });
  }
}
