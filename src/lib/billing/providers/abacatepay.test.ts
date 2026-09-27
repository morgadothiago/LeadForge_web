import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { AppError } from "@/lib/errors";
import { AbacatePayPaymentProvider } from "./abacatepay";

/**
 * SPEC-047 — testes do adapter AbacatePay. NUNCA chama a API real (axios adapter mockado, mesmo padrão
 * de `whatsapp/providers/evolution.test.ts`); `webhookSecret`/`apiKey` são valores de teste, não segredos reais.
 */

const API_KEY = "test-abacatepay-api-key";
const WEBHOOK_SECRET = "test-abacatepay-webhook-secret-32chars-min";

type Step = { status: number; data?: unknown } | { code: string };
function setup(steps: Step[]) {
  const calls: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config);
    const s = steps[Math.min(calls.length - 1, steps.length - 1)]!;
    if ("code" in s) throw new AxiosError("boom", s.code, config);
    const res = { data: s.data ?? {}, status: s.status, statusText: "", headers: {}, config, request: {} };
    if (s.status < 300) return res;
    throw new AxiosError(`Request failed ${s.status}`, "ERR_BAD_RESPONSE", config, {}, res);
  };
  const p = new AbacatePayPaymentProvider({ apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET, adapter, retry: false, clock: () => new Date("2026-09-27T12:00:00Z") });
  return { p, calls };
}
const fail = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as AppError;

let org: TestOrg;
beforeAll(async () => {
  org = await createTestOrg("abacatepay-provider");
});
afterEach(async () => {
  await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
  await prisma.webhookEvent.deleteMany({ where: { orgId: org.orgId } });
});
afterAll(() => purgeTestOrg(org));

describe("AbacatePayPaymentProvider (SPEC-047)", () => {
  describe("createCheckoutSession", () => {
    it("method 'card' (default): chama /subscriptions/create e devolve url/sessionId (D-047-1)", async () => {
      const { p, calls } = setup([{ status: 200, data: { data: { id: "sub_abc123", url: "https://abacatepay.test/pay/sub_abc123" } } }]);
      const r = await p.createCheckoutSession({
        orgId: org.orgId, planKey: "starter", cadence: "monthly", customerEmail: "dono@example.com",
        successUrl: "http://app.test/assinatura?ok=1", cancelUrl: "http://app.test/assinatura?cancel=1",
      });
      expect(r).toEqual({ url: "https://abacatepay.test/pay/sub_abc123", sessionId: "sub_abc123" });
      expect(calls[0].url).toBe("/subscriptions/create");
      expect(calls[0].headers.get("Authorization")).toBe(`Bearer ${API_KEY}`);
      const body = JSON.parse(calls[0].data);
      expect(body).toMatchObject({ cycle: "MONTHLY", method: "CREDIT_CARD", metadata: { orgId: org.orgId, planKey: "starter", cadence: "monthly" } });
    });

    it("method 'pix': chama /transparents/create e devolve o campo pix (brCode/brCodeBase64/expiresAt)", async () => {
      const { p, calls } = setup([{ status: 200, data: { data: { id: "pix_xyz", brCode: "000201...", brCodeBase64: "data:image/png;base64,AA", expiresAt: "2026-09-28T12:00:00Z" } } }]);
      const r = await p.createCheckoutSession({
        orgId: org.orgId, planKey: "starter", cadence: "monthly", customerEmail: "dono@example.com",
        successUrl: "http://app.test/assinatura?ok=1", cancelUrl: "http://app.test/assinatura?cancel=1", method: "pix",
      });
      expect(r.sessionId).toBe("pix_xyz");
      expect(r.url).toContain("session_id=pix_xyz");
      expect(r.pix).toEqual({ chargeId: "pix_xyz", brCode: "000201...", brCodeBase64: "data:image/png;base64,AA", expiresAt: new Date("2026-09-28T12:00:00Z") });
      expect(calls[0].url).toBe("/transparents/create");
      const body = JSON.parse(calls[0].data);
      expect(body.method).toBe("PIX");
    });

    it("plano 'business' (sem checkout self-service) é recusado, sem chamar a API", async () => {
      const { p, calls } = setup([{ status: 200, data: {} }]);
      await expect(
        p.createCheckoutSession({ orgId: org.orgId, planKey: "business", cadence: "monthly", customerEmail: "d@e.com", successUrl: "http://a", cancelUrl: "http://b" }),
      ).rejects.toBeInstanceOf(AppError);
      expect(calls).toHaveLength(0);
    });

    it("plano inexistente é recusado", async () => {
      const { p } = setup([]);
      await expect(
        p.createCheckoutSession({ orgId: org.orgId, planKey: "plano-fantasma", cadence: "monthly", customerEmail: "d@e.com", successUrl: "http://a", cancelUrl: "http://b" }),
      ).rejects.toBeInstanceOf(AppError);
    });

    it("resposta fora do formato esperado -> AppError upstream", async () => {
      const { p } = setup([{ status: 200, data: { data: { foo: "bar" } } }]);
      const e = await fail(
        p.createCheckoutSession({ orgId: org.orgId, planKey: "starter", cadence: "monthly", customerEmail: "d@e.com", successUrl: "http://a", cancelUrl: "http://b" }),
      );
      expect(e.code).toBe("upstream");
    });
  });

  describe("createPortalSession", () => {
    it("devolve erro tratado (AppError, code=config), nunca lança exceção não capturada, mesmo sem chamar a API", async () => {
      const { p, calls } = setup([]);
      const e = await fail(p.createPortalSession({ orgId: org.orgId, returnUrl: "http://app.test/assinatura" }));
      expect(e).toBeInstanceOf(AppError);
      expect(e.code).toBe("config");
      expect(e.userMessage).toBe("Gestão de assinatura indisponível para este provedor.");
      expect(calls).toHaveLength(0);
    });
  });

  describe("verifyWebhookSignature (D-047-2)", () => {
    const { p } = setup([]);
    it("secret correto -> true", () => expect(p.verifyWebhookSignature("{}", WEBHOOK_SECRET)).toBe(true));
    it("secret errado -> false", () => expect(p.verifyWebhookSignature("{}", "secret-errado-mas-mesmo-tamanho-aaaaaaaaaa")).toBe(false));
    it("secret ausente (null) -> false", () => expect(p.verifyWebhookSignature("{}", null)).toBe(false));
    it("secret de tamanho diferente -> false (sem lançar)", () => expect(p.verifyWebhookSignature("{}", "curto")).toBe(false));
  });

  describe("parseWebhookEvent (mapeamento pro vocabulário interno, status-map.ts)", () => {
    const { p } = setup([]);

    it("JSON inválido -> lança AppError(validation)", () => {
      expect(() => p.parseWebhookEvent("{ nao é json")).toThrow(AppError);
    });

    it("envelope sem 'id' -> lança AppError(validation) (payload não reconhecível, nem idempotência dá pra garantir)", () => {
      expect(() => p.parseWebhookEvent(JSON.stringify({ event: "subscription.completed", data: {} }))).toThrow(AppError);
    });

    it("evento fora do vocabulário tratado (ex.: checkout.completed, não gerado por este adapter) -> null (ignorado)", () => {
      expect(p.parseWebhookEvent(JSON.stringify({ id: "evt_1", event: "checkout.completed", data: {} }))).toBeNull();
    });

    it("evento reconhecido mas sem metadata.orgId/planKey/cadence -> null (sem correlação confiável, nunca 500)", () => {
      expect(p.parseWebhookEvent(JSON.stringify({ id: "evt_2", event: "subscription.completed", data: {} }))).toBeNull();
    });

    it("subscription.completed -> subscription.created / status active", () => {
      const evt = p.parseWebhookEvent(JSON.stringify({
        id: "evt_3", event: "subscription.completed",
        data: { id: "sub_1", customerId: "cus_1", metadata: { orgId: org.orgId, planKey: "starter", cadence: "monthly" } },
      }));
      expect(evt).toMatchObject({ eventId: "evt_3", type: "subscription.created", orgId: org.orgId, planKey: "starter", cadence: "monthly", status: "active", externalSubscriptionId: "sub_1", externalCustomerId: "cus_1" });
      // sem nextBillingAt/currentPeriodEnd no payload -> cai no fallback (agora + 1 ciclo, mesmo cálculo de mock.ts).
      expect(evt?.currentPeriodEnd).toEqual(new Date(new Date("2026-09-27T12:00:00Z").getTime() + 30 * 24 * 3600_000));
    });

    it("subscription.renewed -> subscription.updated / status active, usa nextBillingAt quando presente", () => {
      const evt = p.parseWebhookEvent(JSON.stringify({
        id: "evt_4", event: "subscription.renewed",
        data: { id: "sub_1", nextBillingAt: "2026-10-27T12:00:00Z", metadata: { orgId: org.orgId, planKey: "starter", cadence: "monthly" } },
      }));
      expect(evt).toMatchObject({ eventId: "evt_4", type: "subscription.updated", orgId: org.orgId, status: "active", externalSubscriptionId: "sub_1" });
      expect(evt?.currentPeriodEnd).toEqual(new Date("2026-10-27T12:00:00Z"));
    });

    it("transparent.completed (PIX pago) -> subscription.updated / status active, currentPeriodEnd = agora + 1 ciclo", () => {
      const evt = p.parseWebhookEvent(JSON.stringify({
        id: "evt_5", event: "transparent.completed",
        data: { id: "pix_1", metadata: { orgId: org.orgId, planKey: "starter", cadence: "monthly" } },
      }));
      expect(evt).toMatchObject({ eventId: "evt_5", type: "subscription.updated", orgId: org.orgId, planKey: "starter", cadence: "monthly", status: "active", externalSubscriptionId: "pix_1", externalCustomerId: null });
      expect(evt?.currentPeriodEnd).toEqual(new Date(new Date("2026-09-27T12:00:00Z").getTime() + 30 * 24 * 3600_000));
    });

    it("transparent.completed com cadence anual -> currentPeriodEnd = agora + 365 dias", () => {
      const evt = p.parseWebhookEvent(JSON.stringify({
        id: "evt_6", event: "transparent.completed",
        data: { id: "pix_2", metadata: { orgId: org.orgId, planKey: "pro", cadence: "yearly" } },
      }));
      expect(evt?.currentPeriodEnd).toEqual(new Date(new Date("2026-09-27T12:00:00Z").getTime() + 365 * 24 * 3600_000));
    });
  });
});
