import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AxiosInstance } from "axios";
import type { BillingCadence } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { createHttpClient, type HttpClientOptions } from "@/lib/http";
import type { CheckoutSessionInput, CheckoutSessionResult, ParsedBillingEvent, PaymentProvider, PortalSessionInput, PortalSessionResult } from "../provider";

/**
 * SPEC-047 (D-047-1/D-047-2) — adapter AbacatePay (gateway brasileiro, foco em PIX). Implementação
 * COMPLETA em código, mas SEM chamada de rede real até `ABACATEPAY_API_KEY` estar configurada (só é
 * instanciado se `PAYMENT_PROVIDER=abacatepay` E `ABACATEPAY_API_KEY`/`ABACATEPAY_WEBHOOK_SECRET`
 * estiverem presentes, `provider-factory.ts` — mesmo padrão do stub Stripe, D-33-5).
 *
 * NUNCA testado contra a API real do AbacatePay (sem credenciais) — NOT VERIFIED end-to-end, mesmo
 * espírito de `providers/stripe.ts`. A pesquisa da doc oficial confirmou o formato de auth, os 3
 * endpoints usados aqui e os campos de resposta citados abaixo como "CONFIRMADO"; qualquer outro campo
 * de request/response está marcado "ASSUMIDO" (best-effort baseado no padrão comum de gateways
 * brasileiros) — a spec.md (seção Riscos) já pede para revalidar isso na doc interativa antes de ativar
 * em produção.
 *
 * D-047-1 (HÍBRIDO): `createCheckoutSession` escolhe cartão OU PIX (`input.method`, default "card"):
 * - "card": `POST /subscriptions/create` — recorrência REAL gerenciada pela AbacatePay (cobrança
 *   automática, retryPolicy, trialDays). Não precisamos reimplementar nada de ciclo aqui.
 * - "pix":  `POST /transparents/create` — cobrança avulsa (PIX não suporta recorrência nativa nesse
 *   provedor). A renovação de cada ciclo é responsabilidade do LeadForge — `createPixCharge` (método
 *   público adicional, fora da interface `PaymentProvider` genérica, chamado só por
 *   `src/lib/billing/pix-renewal.ts`, o job de renovação).
 *
 * D-047-2: autenticação do webhook é o `webhookSecret` (comparação em tempo constante) — a ÚNICA camada
 * real por conta. O header `X-Webhook-Signature` (HMAC com chave PÚBLICA, igual para todas as contas,
 * conforme a doc) NÃO é validado aqui: não é segredo nenhum, então uma verificação dele não aumentaria a
 * segurança real, só complexidade — mantido documentado como decisão explícita, não como omissão.
 *
 * LIMITAÇÃO CONHECIDA (plumbing pendente, fora do escopo desta SPEC): o AbacatePay envia `webhookSecret`
 * como QUERY PARAM da URL de callback, não como header. O receiver HTTP genérico e compartilhado entre
 * todos os providers (`src/lib/billing/webhook-handler.ts` + `src/app/api/billing/webhook/route.ts`,
 * SPEC-033) hoje só extrai `request.headers.get("stripe-signature")` e passa isso como 2º argumento de
 * `verifyWebhookSignature` — ele NUNCA lê a query string. Por instrução explícita desta SPEC ("nenhuma
 * mudança no resto do fluxo de webhook"), esse receiver genérico não foi alterado aqui. `verifyWebhookSignature`
 * abaixo está implementado corretamente (compara `presentedSecret` contra `this.webhookSecret` em tempo
 * constante) e é 100% testável isoladamente — mas, ATÉ que `webhook-handler.ts`/`route.ts` sejam ajustados
 * para extrair `webhookSecret` da query string e passá-lo aqui, o webhook do AbacatePay não fica de fato
 * autenticável em produção via essa rota compartilhada. Reportado como limitação conhecida (não uma
 * omissão silenciosa) — decisão de estender o receiver fica para o usuário/uma SPEC específica.
 */

const BASE_URL = "https://api.abacatepay.com/v2";
const CADENCE_TO_CYCLE: Record<BillingCadence, string> = { monthly: "MONTHLY", yearly: "YEARLY" };
/** Mesmo cálculo de duração de ciclo usado em `providers/mock.ts` (30/365 dias) — usado quando o AbacatePay não devolve a próxima data de cobrança. */
export const CYCLE_MS: Record<BillingCadence, number> = { monthly: 30 * 24 * 3600_000, yearly: 365 * 24 * 3600_000 };

export interface AbacatePayOptions {
  apiKey: string;
  webhookSecret: string;
  adapter?: HttpClientOptions["adapter"];
  retry?: HttpClientOptions["retry"];
  logger?: HttpClientOptions["logger"];
  /** Testes: injeta o "agora" usado para calcular `currentPeriodEnd` quando o AbacatePay não devolve a próxima data. */
  clock?: () => Date;
}

export interface CreatePixChargeInput {
  orgId: string;
  planKey: string;
  cadence: BillingCadence;
  customerEmail: string;
}
export interface CreatePixChargeResult {
  chargeId: string;
  brCode: string;
  brCodeBase64: string;
  expiresAt: Date;
}

// CONFIRMADO na doc (spec.md): brCode/brCodeBase64/expiresAt. `id` ASSUMIDO (todo gateway com webhook de
// confirmação precisa de algum identificador da cobrança; sem ele não daria pra correlacionar o evento).
const transparentsRes = z.object({
  data: z.object({ id: z.string().min(1), brCode: z.string().min(1), brCodeBase64: z.string().min(1), expiresAt: z.string() }),
});
// ASSUMIDO: `id` da subscription + (opcional) `url` para o cliente inserir o cartão/confirmar. Não
// confirmado na doc pública (spec.md, seção Riscos) — revalidar antes de ativar em produção.
const subscriptionsRes = z.object({
  data: z.object({ id: z.string().min(1), url: z.string().nullish(), status: z.string().nullish() }),
});

function invalid(): AppError {
  return new AppError({ code: "upstream", userMessage: "AbacatePay devolveu uma resposta inesperada." });
}

export class AbacatePayPaymentProvider implements PaymentProvider {
  readonly name = "abacatepay" as const;
  private readonly http: AxiosInstance;
  private readonly webhookSecret: string;
  private readonly clock: () => Date;

  constructor(opts: AbacatePayOptions) {
    this.webhookSecret = opts.webhookSecret;
    this.clock = opts.clock ?? (() => new Date());
    // CONFIRMADO na doc (spec.md): `Authorization: Bearer <API_KEY>`; sem URL de sandbox separada (o
    // ambiente é determinado pela própria chave — toda resposta traz `devMode`).
    this.http = createHttpClient({
      name: "AbacatePay", baseURL: BASE_URL, timeout: 20_000,
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      adapter: opts.adapter, retry: opts.retry, logger: opts.logger,
    });
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const plan = await prisma.plan.findUnique({ where: { key: input.planKey }, select: { key: true, active: true, selfServiceCheckout: true, priceMonthlyCents: true, priceYearlyCents: true } });
    if (!plan || !plan.active) throw new AppError({ code: "not_found", userMessage: "Plano não encontrado." });
    if (!plan.selfServiceCheckout) throw new AppError({ code: "validation", userMessage: "Este plano não tem checkout self-service. Entre em contato com vendas." });
    const amountCents = input.cadence === "yearly" ? (plan.priceYearlyCents ?? plan.priceMonthlyCents) : plan.priceMonthlyCents;

    if ((input.method ?? "card") === "pix") {
      const pix = await this.createPixCharge({ orgId: input.orgId, planKey: input.planKey, cadence: input.cadence, customerEmail: input.customerEmail });
      return {
        url: `${input.successUrl}${input.successUrl.includes("?") ? "&" : "?"}session_id=${pix.chargeId}`,
        sessionId: pix.chargeId,
        pix,
      };
    }

    // D-047-1 (cartão): recorrência REAL gerenciada pela AbacatePay. ASSUMIDO: request body/response.url —
    // ver comentário do topo do arquivo/spec.md (Riscos).
    const { data } = await this.http.post("/subscriptions/create", {
      cycle: CADENCE_TO_CYCLE[input.cadence],
      amount: amountCents,
      method: "CREDIT_CARD",
      customer: { email: input.customerEmail },
      returnUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      metadata: { orgId: input.orgId, planKey: input.planKey, cadence: input.cadence },
    });
    const r = subscriptionsRes.safeParse(data);
    if (!r.success) throw invalid();
    return { url: r.data.data.url ?? input.successUrl, sessionId: r.data.data.id };
  }

  /** SPEC-047 (D-047-1) — não faz parte da interface `PaymentProvider` genérica: só chamado por `src/lib/billing/pix-renewal.ts`. */
  async createPixCharge(input: CreatePixChargeInput): Promise<CreatePixChargeResult> {
    const plan = await prisma.plan.findUnique({ where: { key: input.planKey }, select: { priceMonthlyCents: true, priceYearlyCents: true } });
    if (!plan) throw new AppError({ code: "not_found", userMessage: "Plano não encontrado." });
    const amountCents = input.cadence === "yearly" ? (plan.priceYearlyCents ?? plan.priceMonthlyCents) : plan.priceMonthlyCents;

    // CONFIRMADO na doc (spec.md): method "PIX", resposta com brCode/brCodeBase64/expiresAt. ASSUMIDO: os
    // demais campos do body (amount/description/customer/metadata) e o campo `id` da resposta.
    const { data } = await this.http.post("/transparents/create", {
      amount: amountCents,
      method: "PIX",
      description: `LeadForge — plano ${input.planKey} (${input.cadence === "yearly" ? "anual" : "mensal"})`,
      customer: { email: input.customerEmail },
      metadata: { orgId: input.orgId, planKey: input.planKey, cadence: input.cadence },
    });
    const r = transparentsRes.safeParse(data);
    if (!r.success) throw invalid();
    return { chargeId: r.data.data.id, brCode: r.data.data.brCode, brCodeBase64: r.data.data.brCodeBase64, expiresAt: new Date(r.data.data.expiresAt) };
  }

  async createPortalSession(_input: PortalSessionInput): Promise<PortalSessionResult> {
    // CONFIRMADO na doc (spec.md): não existe portal de self-service no AbacatePay (nenhuma página
    // hospedada tipo Stripe Billing Portal) — erro tratado em vez de quebrar (Fora do escopo, spec.md).
    throw new AppError({ code: "config", userMessage: "Gestão de assinatura indisponível para este provedor." });
  }

  /**
   * D-047-2: compara `presentedSecret` (o `webhookSecret` da query string da URL de callback — ver
   * LIMITAÇÃO CONHECIDA no topo do arquivo sobre como esse valor chega até aqui hoje) contra
   * `this.webhookSecret`, em tempo constante (mesmo padrão de `secretsMatch`,
   * `src/lib/scheduler/cron-endpoint.ts`). Nunca loga `presentedSecret`/a URL completa (D-047-2).
   */
  verifyWebhookSignature(_rawBody: string, presentedSecret: string | null): boolean {
    if (!presentedSecret) return false;
    const a = Buffer.from(presentedSecret);
    const b = Buffer.from(this.webhookSecret);
    if (a.length !== b.length) return false; // timingSafeEqual exige mesmo tamanho; tamanhos diferentes já não batem.
    return timingSafeEqual(a, b);
  }

  parseWebhookEvent(rawBody: string): ParsedBillingEvent | null {
    // A verificação de assinatura (verifyWebhookSignature) já rodou antes de chamar isto (webhook-handler.ts).
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new AppError({ code: "validation", userMessage: "Payload de webhook inválido." });
    }
    return mapAbacatePayEvent(json, this.clock());
  }
}

// Envelope CONFIRMADO na doc (spec.md): {id, event, apiVersion, devMode, data}. `id` = idempotência
// (campo do payload, não gerado por nós — reaproveitado como `ParsedBillingEvent.eventId`, mesma
// unicidade global que `processBillingEvent`/`WebhookEvent.eventId` já garantem para todos os providers).
const envelope = z.object({
  id: z.string().min(1),
  event: z.string().min(1),
  data: z.record(z.string(), z.unknown()).nullish(),
});

const EVENTS_HANDLED = new Set(["subscription.completed", "subscription.renewed", "transparent.completed"]);
const CADENCES = new Set(["monthly", "yearly"]);

/**
 * Mapeia o vocabulário do AbacatePay para `BillingEventType`/`ParsedBillingEvent` (`status-map.ts`).
 * ASSUMIDO (spec.md, Riscos): correlação com `orgId`/`planKey`/`cadence` via `data.metadata` — o mesmo
 * objeto `metadata` que ESTE adapter envia em `createPixCharge`/`createCheckoutSession` (cartão), que o
 * AbacatePay deveria ecoar de volta no payload (padrão comum de gateway; não confirmado por fetch direto
 * contra a doc interativa). Sem `metadata.orgId`/`metadata.planKey`/`metadata.cadence` válidos, o evento é
 * tratado como não reconhecido (`null` — ignorado, nunca 500), igual a qualquer outro provider.
 * Eventos fora de `EVENTS_HANDLED` (ex.: `checkout.completed`, que não é gerado por este adapter — D-047-1
 * não usa `/payment/create` — nem eventos de gestão de subscription não implementados aqui,
 * subscriptions/cancel|change-plan) também retornam `null`.
 */
function mapAbacatePayEvent(json: unknown, now: Date): ParsedBillingEvent | null {
  const env = envelope.safeParse(json);
  if (!env.success) throw new AppError({ code: "validation", userMessage: "Payload de webhook inválido." });
  if (!EVENTS_HANDLED.has(env.data.event)) return null;

  const data = env.data.data ?? {};
  const metadata = (data.metadata && typeof data.metadata === "object" ? (data.metadata as Record<string, unknown>) : {}) as Record<string, unknown>;
  const orgId = typeof metadata.orgId === "string" ? metadata.orgId : null;
  const planKey = typeof metadata.planKey === "string" ? metadata.planKey : null;
  const cadence = typeof metadata.cadence === "string" && CADENCES.has(metadata.cadence) ? (metadata.cadence as BillingCadence) : null;
  if (!orgId || !planKey || !cadence) return null; // não reconhecível (sem correlação confiável) — ignorado, nunca 500.

  if (env.data.event === "subscription.completed") {
    return {
      eventId: env.data.id, type: "subscription.created", orgId, planKey, cadence, status: "active",
      currentPeriodEnd: readDate(data.nextBillingAt ?? data.currentPeriodEnd) ?? new Date(now.getTime() + CYCLE_MS[cadence]),
      cancelAtPeriodEnd: false,
      externalCustomerId: readString(data.customerId), externalSubscriptionId: readString(data.id),
    };
  }
  if (env.data.event === "subscription.renewed") {
    return {
      eventId: env.data.id, type: "subscription.updated", orgId, planKey, cadence, status: "active",
      currentPeriodEnd: readDate(data.nextBillingAt ?? data.currentPeriodEnd) ?? new Date(now.getTime() + CYCLE_MS[cadence]),
      cancelAtPeriodEnd: false,
      externalCustomerId: readString(data.customerId), externalSubscriptionId: readString(data.id),
    };
  }
  // transparent.completed (PIX avulso pago, D-047-1): marca o período pago e estende currentPeriodEnd por
  // um ciclo (o AbacatePay não gerencia recorrência de PIX — não há "próxima cobrança" no payload dele).
  return {
    eventId: env.data.id, type: "subscription.updated", orgId, planKey, cadence, status: "active",
    currentPeriodEnd: new Date(now.getTime() + CYCLE_MS[cadence]),
    cancelAtPeriodEnd: false,
    externalCustomerId: null, externalSubscriptionId: readString(data.id),
  };
}

function readString(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
function readDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
