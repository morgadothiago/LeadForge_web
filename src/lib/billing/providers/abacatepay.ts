import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AxiosInstance } from "axios";
import type { BillingCadence } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { isProductionEnv } from "@/lib/env";
import { createHttpClient, type HttpClientOptions } from "@/lib/http";
import type { CancelSubscriptionInput, CancelSubscriptionResult, ResumeSubscriptionInput, ResumeSubscriptionResult, CheckoutSessionInput, CheckoutSessionResult, ParsedBillingEvent, PaymentProvider, PortalSessionInput, PortalSessionResult } from "../provider";
import { AbacateClient } from "./abacatepay-client";
import { assertExpectedDevMode, ensureProduct, keyFingerprintOf, priceFor } from "./abacatepay-catalog";
import { parseAbacatePayWebhook } from "./abacatepay-webhook";

/**
 * SPEC-047 (D-047-1/D-047-2) reescrita pela SPEC-063 (063a) sobre o contrato REAL da API v2 (validado em dev mode em 2026-10-12;
 * achados na SPEC, "Implementation Notes"). Instanciado so se `PAYMENT_PROVIDER=abacatepay` E `ABACATEPAY_API_KEY`/`ABACATEPAY_WEBHOOK_SECRET`
 * estiverem presentes (`provider-factory.ts`).
 *
 * D-047-1 (HIBRIDO): `createCheckoutSession` escolhe cartao OU PIX (`input.method`, default "card"):
 * - "card": produto no catalogo (`abacatepay-catalog.ts`) -> `POST /subscriptions/create` (cria um CHECKOUT `bill_...`; a assinatura
 *   `subs_...` so existe apos o pagamento) — recorrencia REAL gerenciada pela AbacatePay.
 * - "pix":  `POST /transparents/create` — cobranca avulsa; a renovacao de cada ciclo e do LeadForge (`createPixCharge`, `pix-renewal.ts`).
 *
 * Autenticacao do webhook (D-047-2/D-063-16): `?webhookSecret=` em tempo constante. A verificacao do HMAC `X-Webhook-Signature` e da 063b.
 * Correlacao pagamento -> organizacao e parser: `abacatepay-webhook.ts`. Erros 4xx: `abacatepay-client.ts` / `abacatepay-errors.ts`.
 */

const BASE_URL = "https://api.abacatepay.com/v2";

export interface AbacatePayOptions {
  apiKey: string;
  webhookSecret: string;
  adapter?: HttpClientOptions["adapter"];
  retry?: HttpClientOptions["retry"];
  logger?: HttpClientOptions["logger"];
  /** Testes: injeta o "agora" usado no parser do webhook (periodo, validade de datas). */
  clock?: () => Date;
  /** Testes: captura as linhas de log de erro 4xx (default `console.error`). */
  errorLog?: (line: string) => void;
}

export interface CreatePixChargeInput {
  orgId: string;
  planKey: string;
  cadence: BillingCadence;
  /** Mantido na interface (job de renovacao): NAO e enviado ao provedor — `customer` so com e-mail da 422 (D-063-18). */
  customerEmail: string;
  /** Fim do periodo que esta cobranca renova (so compoe o `externalId`). */
  periodEndMs?: number;
}
export interface CreatePixChargeResult {
  chargeId: string;
  brCode: string;
  brCodeBase64: string;
  expiresAt: Date;
}

// Respostas: zod LENIENTE (so o que usamos), formatos REAIS validados em dev mode.
const transparentsRes = z.object({
  data: z.object({ id: z.string().min(1), brCode: z.string().min(1), brCodeBase64: z.string().min(1), expiresAt: z.string(), devMode: z.boolean().optional() }),
});
const checkoutRes = z.object({
  data: z.object({ id: z.string().min(1), url: z.string().min(1), devMode: z.boolean().optional(), status: z.string().nullish() }),
});

function invalid(): AppError {
  return new AppError({ code: "upstream", userMessage: "AbacatePay devolveu uma resposta inesperada." });
}

/** D-063-7: so devolve ao usuario uma URL https do dominio abacatepay.com (guarda contra resposta inesperada). */
export function isTrustedCheckoutUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.hostname === "abacatepay.com" || u.hostname.endsWith(".abacatepay.com"));
  } catch {
    return false;
  }
}

/** A API recusa caracteres fora do ASCII basico em `description` do PIX (ex.: travessao U+2014 da 400). */
function asciiOnly(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "-");
}

export class AbacatePayPaymentProvider implements PaymentProvider {
  readonly name = "abacatepay" as const;
  private readonly http: AxiosInstance;
  private readonly client: AbacateClient;
  private readonly webhookSecret: string;
  private readonly keyFingerprint: string;
  private readonly clock: () => Date;

  constructor(opts: AbacatePayOptions) {
    this.webhookSecret = opts.webhookSecret;
    this.keyFingerprint = keyFingerprintOf(opts.apiKey);
    this.clock = opts.clock ?? (() => new Date());
    // `Authorization: Bearer <API_KEY>`; sem URL de sandbox separada (o ambiente e a propria chave — toda resposta traz `devMode`).
    this.http = createHttpClient({
      name: "AbacatePay", baseURL: BASE_URL, timeout: 20_000,
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      adapter: opts.adapter, retry: opts.retry, logger: opts.logger,
    });
    this.client = new AbacateClient(this.http, () => [opts.apiKey, opts.webhookSecret], opts.errorLog);
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const plan = await prisma.plan.findUnique({ where: { key: input.planKey }, select: { id: true, key: true, name: true, active: true, selfServiceCheckout: true, priceMonthlyCents: true, priceYearlyCents: true } });
    if (!plan || !plan.active) throw new AppError({ code: "not_found", userMessage: "Plano não encontrado." });
    if (!plan.selfServiceCheckout) throw new AppError({ code: "validation", userMessage: "Este plano não tem checkout self-service. Entre em contato com vendas." });
    priceFor(plan, input.cadence); // D-063-4: yearly sem preco anual = recusa ANTES de qualquer chamada de rede.

    if ((input.method ?? "card") === "pix") {
      const pix = await this.createPixCharge({ orgId: input.orgId, planKey: input.planKey, cadence: input.cadence, customerEmail: input.customerEmail });
      return {
        url: `${input.successUrl}${input.successUrl.includes("?") ? "&" : "?"}session_id=${pix.chargeId}`,
        sessionId: pix.chargeId,
        pix,
      };
    }

    // D-063-6: o valor e o ciclo vem do PRODUTO; o corpo so tem campos que a API aceita.
    const product = await ensureProduct({ client: this.client, keyFingerprint: this.keyFingerprint, plan, cadence: input.cadence });
    const res = await this.client.post("/subscriptions/create", {
      items: [{ id: product.providerProductId, quantity: 1 }],
      methods: ["CARD"],
      externalId: `lf:${input.orgId}:${randomBytes(4).toString("hex")}`,
      completionUrl: input.successUrl,
      returnUrl: input.cancelUrl,
      // Auditoria/diagnostico apenas: a correlacao do pagamento nunca depende deste campo (D-063-8).
      metadata: { orgId: input.orgId, planKey: input.planKey, cadence: input.cadence },
      retryPolicy: { maxRetry: 3, retryEvery: 2 },
    });
    const r = checkoutRes.safeParse(res);
    if (!r.success || !isTrustedCheckoutUrl(r.data.data.url)) throw invalid();
    assertExpectedDevMode(r.data.data.devMode);
    // D-063-7: elo do pagamento -> organizacao (a casca/assinatura da org ja existe antes do checkout).
    await prisma.subscription.updateMany({ where: { orgId: input.orgId }, data: { externalCheckoutId: r.data.data.id } });
    return { url: r.data.data.url, sessionId: r.data.data.id };
  }

  /** SPEC-047 (D-047-1) — não faz parte da interface `PaymentProvider` genérica: só chamado por `src/lib/billing/pix-renewal.ts`. */
  async createPixCharge(input: CreatePixChargeInput): Promise<CreatePixChargeResult> {
    const plan = await prisma.plan.findUnique({ where: { key: input.planKey }, select: { priceMonthlyCents: true, priceYearlyCents: true } });
    if (!plan) throw new AppError({ code: "not_found", userMessage: "Plano não encontrado." });
    const amountCents = priceFor(plan, input.cadence); // D-063-4: nunca cai no preco mensal.

    // D-063-18: corpo real `{method, data:{...}}`, SEM `customer` (so e-mail = 422; name+taxId viram obrigatorios).
    // `externalId` repetido devolve a MESMA cobranca (idempotente no provedor, inclusive expirada) — por isso leva um sufixo por tentativa.
    const res = await this.client.post("/transparents/create", {
      method: "PIX",
      data: {
        amount: amountCents,
        description: asciiOnly(`LeadForge - plano ${input.planKey} (${input.cadence === "yearly" ? "anual" : "mensal"})`),
        externalId: `lf-pix:${input.orgId}:${input.periodEndMs ?? this.clock().getTime()}:${randomBytes(4).toString("hex")}`,
        metadata: { orgId: input.orgId, planKey: input.planKey, cadence: input.cadence },
      },
    });
    const r = transparentsRes.safeParse(res);
    if (!r.success) throw invalid();
    assertExpectedDevMode(r.data.data.devMode);
    return { chargeId: r.data.data.id, brCode: r.data.data.brCode, brCodeBase64: r.data.data.brCodeBase64, expiresAt: new Date(r.data.data.expiresAt) };
  }

  /** Somente TESTE/dev mode: simula o pagamento de uma cobranca PIX (`POST /transparents/simulate-payment`). Recusado em producao. */
  async simulatePixPayment(chargeId: string): Promise<void> {
    if (isProductionEnv()) throw new AppError({ code: "config", userMessage: "Operação indisponível." });
    await this.client.request("POST", "/transparents/simulate-payment", { params: { id: chargeId }, data: {} });
  }

  async createPortalSession(_input: PortalSessionInput): Promise<PortalSessionResult> {
    // CONFIRMADO na doc: não existe portal de self-service no AbacatePay — erro tratado em vez de quebrar.
    throw new AppError({ code: "config", userMessage: "Gestão de assinatura indisponível para este provedor." });
  }

  /**
   * SPEC-053a (D-053-5), INALTERADO na 063a (cancelar/reativar/trocar plano = 063b): sem chamada ao provedor, `providerConfirmed:false`.
   * LIMITACAO ate a 063b: a recorrencia do cartao no provedor continua ate ser cancelada la (`POST /subscriptions/cancel`).
   */
  async cancelSubscription(_input: CancelSubscriptionInput): Promise<CancelSubscriptionResult> {
    return { providerConfirmed: false };
  }

  async resumeSubscription(_input: ResumeSubscriptionInput): Promise<ResumeSubscriptionResult> {
    return { providerConfirmed: false };
  }

  /**
   * D-047-2: compara `presentedSecret` (o `webhookSecret` da query string da URL de callback) contra `this.webhookSecret`, em tempo
   * constante (mesmo padrão de `secretsMatch`, `src/lib/scheduler/cron-endpoint.ts`). Nunca loga `presentedSecret`/a URL completa.
   */
  verifyWebhookSignature(_rawBody: string, presentedSecret: string | null): boolean {
    if (!presentedSecret) return false;
    const a = Buffer.from(presentedSecret);
    const b = Buffer.from(this.webhookSecret);
    if (a.length !== b.length) return false; // timingSafeEqual exige mesmo tamanho; tamanhos diferentes já não batem.
    return timingSafeEqual(a, b);
  }

  /** Assincrono (D-063-12): a correlacao consulta o banco e, como ultimo recurso, a API. A autenticacao ja rodou no handler. */
  parseWebhookEvent(rawBody: string): Promise<ParsedBillingEvent | null> {
    return parseAbacatePayWebhook(rawBody, { now: this.clock(), client: this.client, keyFingerprint: this.keyFingerprint });
  }
}
