import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AxiosError } from "axios";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { AppError } from "@/lib/errors";
import { AbacatePayPaymentProvider } from "./abacatepay";
import { keyFingerprintOf, productExternalId } from "./abacatepay-catalog";
import { fakeAbacateApi, productsCreateSchema, subscriptionsCreateSchema, transparentsCreateSchema, type FakeApi } from "./abacatepay.test-helper";

/**
 * SPEC-047/063 — testes do adapter AbacatePay. NUNCA chama a API real (axios adapter falso com esquemas ESTRITOS do OpenAPI:
 * campo extra/ausente no corpo = 422, a regressao do primeiro teste real); `apiKey`/`webhookSecret` sao valores de teste.
 */

const API_KEY = "test-abacatepay-api-key-063-xxxxxxxx";
const WEBHOOK_SECRET = "test-abacatepay-webhook-secret-32chars-min";
const FP = keyFingerprintOf(API_KEY);

function setup(api: FakeApi = fakeAbacateApi()) {
  const logs: string[] = [];
  const p = new AbacatePayPaymentProvider({ apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET, adapter: api.adapter, retry: false, clock: () => new Date("2026-09-27T12:00:00Z"), errorLog: (l) => logs.push(l) });
  return { p, api, logs };
}
const fail = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as AppError;

let org: TestOrg;
let tempPlanId: string;
let noYearPlanId: string;
const URLS = { successUrl: "http://app.test/assinar/retorno", cancelUrl: "http://app.test/assinar?checkout=cancel" };
const checkoutInput = (planKey: string, cadence: "monthly" | "yearly" = "monthly") => ({ orgId: org.orgId, planKey, cadence, customerEmail: "dono@example.com", ...URLS });

beforeAll(async () => {
  org = await createTestOrg("abacatepay-provider");
  const base = { active: true, selfServiceCheckout: true, limits: {} };
  tempPlanId = (await prisma.plan.upsert({ where: { key: "zz-063-temp" }, update: { priceMonthlyCents: 1990, priceYearlyCents: 19900 }, create: { key: "zz-063-temp", name: "Temp 063", priceMonthlyCents: 1990, priceYearlyCents: 19900, ...base } })).id;
  noYearPlanId = (await prisma.plan.upsert({ where: { key: "zz-063-noyear" }, update: {}, create: { key: "zz-063-noyear", name: "Sem anual", priceMonthlyCents: 4990, priceYearlyCents: null, ...base } })).id;
});
afterEach(async () => {
  await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
  await prisma.webhookEvent.deleteMany({ where: { orgId: org.orgId } });
  await prisma.billingProduct.deleteMany({ where: { keyFingerprint: FP } });
  await prisma.plan.update({ where: { id: tempPlanId }, data: { priceMonthlyCents: 1990, priceYearlyCents: 19900 } });
  delete process.env.ABACATEPAY_EXPECT_DEVMODE;
  delete process.env.VERCEL_ENV;
});
afterAll(async () => {
  await prisma.billingProduct.deleteMany({ where: { planId: { in: [tempPlanId, noYearPlanId] } } });
  await prisma.plan.deleteMany({ where: { key: { in: ["zz-063-temp", "zz-063-noyear"] } } });
  await purgeTestOrg(org);
});

describe("AbacatePayPaymentProvider (SPEC-047/063)", () => {
  describe("createCheckoutSession (cartao) — contrato real da API v2", () => {
    it("corpo EXATO de subscriptions/create (D-063-6), valida no esquema estrito, grava externalCheckoutId e devolve a URL do checkout", async () => {
      await prisma.subscription.create({ data: { orgId: org.orgId, planId: tempPlanId, status: "incomplete", cadence: "monthly" } });
      const { p, api } = setup();
      const r = await p.createCheckoutSession(checkoutInput("zz-063-temp"));

      const [product] = api.products.values();
      const call = api.callsTo("POST /subscriptions/create")[0]!;
      expect(call.authorization).toBe(`Bearer ${API_KEY}`);
      expect(subscriptionsCreateSchema.safeParse(call.body).success).toBe(true);
      expect(call.body).toEqual({
        items: [{ id: product!.id, quantity: 1 }],
        methods: ["CARD"],
        externalId: expect.stringMatching(new RegExp(`^lf:${org.orgId}:[0-9a-f]{8}$`)),
        completionUrl: URLS.successUrl,
        returnUrl: URLS.cancelUrl,
        metadata: { orgId: org.orgId, planKey: "zz-063-temp", cadence: "monthly" },
        retryPolicy: { maxRetry: 3, retryEvery: 2 },
      });
      // campos que NAO existem na v2 (causa do 422)
      for (const k of ["cycle", "amount", "method", "customer", "cancelUrl"]) expect(call.body).not.toHaveProperty(k);

      expect(r.sessionId).toMatch(/^bill_/);
      expect(r.url).toBe(`https://app.abacatepay.com/pay/${r.sessionId}`);
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } });
      expect(sub.externalCheckoutId).toBe(r.sessionId);
    });

    it("cada tentativa usa um externalId novo (nao reaproveita o anterior)", async () => {
      const { p, api } = setup();
      await p.createCheckoutSession(checkoutInput("zz-063-temp"));
      await p.createCheckoutSession(checkoutInput("zz-063-temp"));
      const ids = api.callsTo("POST /subscriptions/create").map((c) => (c.body as { externalId: string }).externalId);
      expect(new Set(ids).size).toBe(2);
    });

    it("URL fora de https://*.abacatepay.com -> AppError upstream (nunca devolve ao usuario)", async () => {
      const { p, api } = setup();
      api.override("POST /subscriptions/create", () => ({ status: 200, data: { success: true, data: { id: "bill_x", url: "https://evil.example.com/pay/bill_x", devMode: true } } }));
      expect((await fail(p.createCheckoutSession(checkoutInput("zz-063-temp")))).code).toBe("upstream");
      api.override("POST /subscriptions/create", () => ({ status: 200, data: { success: true, data: { id: "bill_x", url: "http://app.abacatepay.com/pay/bill_x", devMode: true } } }));
      expect((await fail(p.createCheckoutSession(checkoutInput("zz-063-temp")))).code).toBe("upstream");
    });

    it("resposta fora do formato esperado -> AppError upstream", async () => {
      const { p, api } = setup();
      api.override("POST /subscriptions/create", () => ({ status: 200, data: { data: { foo: "bar" } } }));
      expect((await fail(p.createCheckoutSession(checkoutInput("zz-063-temp")))).code).toBe("upstream");
    });

    it("plano 'business' (sem checkout self-service) e recusado, sem chamar a API", async () => {
      const { p, api } = setup();
      await expect(p.createCheckoutSession(checkoutInput("business"))).rejects.toBeInstanceOf(AppError);
      expect(api.calls).toHaveLength(0);
    });

    it("plano inexistente e recusado", async () => {
      const { p } = setup();
      await expect(p.createCheckoutSession(checkoutInput("plano-fantasma"))).rejects.toBeInstanceOf(AppError);
    });

    it("D-063-4: yearly sem preco anual -> validation, SEM rede e SEM cair no preco mensal", async () => {
      const { p, api } = setup();
      const e = await fail(p.createCheckoutSession(checkoutInput("zz-063-noyear", "yearly")));
      expect(e.code).toBe("validation");
      expect(e.status).toBeUndefined();
      expect(api.calls).toHaveLength(0);
      const pix = setup();
      expect((await fail(pix.p.createPixCharge({ orgId: org.orgId, planKey: "zz-063-noyear", cadence: "yearly", customerEmail: "a@b.c" }))).code).toBe("validation");
      expect(pix.api.calls).toHaveLength(0);
    });

    it("guarda de ambiente (D-063-5): ABACATEPAY_EXPECT_DEVMODE=false com resposta devMode:true -> config", async () => {
      process.env.ABACATEPAY_EXPECT_DEVMODE = "false";
      const { p } = setup();
      const e = await fail(p.createCheckoutSession(checkoutInput("zz-063-temp")));
      expect(e.code).toBe("config");
    });

    it("422 do provedor: loga metodo/path/status/corpo SEM segredos e relanca validation com status", async () => {
      const { p, api, logs } = setup();
      api.override("POST /subscriptions/create", () => ({ status: 422, data: { success: false, data: null, error: `Property 'items' is missing (Bearer ${API_KEY}) dono@example.com ${WEBHOOK_SECRET}` } }));
      const e = await fail(p.createCheckoutSession(checkoutInput("zz-063-temp")));
      expect(e.code).toBe("validation");
      expect(e.status).toBe(422);
      const line = logs.join("\n");
      expect(line).toContain("[abacatepay] POST /subscriptions/create -> 422");
      expect(line).toContain("Property 'items' is missing");
      expect(line).not.toContain(API_KEY);
      expect(line).not.toContain(WEBHOOK_SECRET);
      expect(line).not.toContain("dono@example.com");
      expect(line).not.toContain("quantity"); // corpo da REQUISICAO nunca e logado
      expect(line).not.toContain(org.orgId);
    });
  });

  describe("catalogo de produtos (D-063-1..3)", () => {
    it("1a vez: list vazio -> create (corpo valido, MONTHLY, sem trialDays); externalId deterministico; cache em BillingProduct", async () => {
      const { p, api } = setup();
      await p.createCheckoutSession(checkoutInput("zz-063-temp"));
      expect(api.callsTo("GET /products/list")[0]!.params).toEqual({ externalId: "lf-zz-063-temp-monthly-1990" });
      const create = api.callsTo("POST /products/create");
      expect(create).toHaveLength(1);
      expect(productsCreateSchema.safeParse(create[0]!.body).success).toBe(true);
      expect(create[0]!.body).toEqual({ externalId: "lf-zz-063-temp-monthly-1990", name: "LeadForge Temp 063 (Mensal)", price: 1990, currency: "BRL", cycle: "MONTHLY" });
      const rows = await prisma.billingProduct.findMany({ where: { keyFingerprint: FP } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ provider: "abacatepay", externalId: "lf-zz-063-temp-monthly-1990", cadence: "monthly", priceCents: 1990, devMode: true, planId: tempPlanId });
    });

    it("anual usa ANNUALLY e o preco ANUAL (nunca YEARLY)", async () => {
      const { p, api } = setup();
      await p.createCheckoutSession(checkoutInput("zz-063-temp", "yearly"));
      expect(api.callsTo("POST /products/create")[0]!.body).toMatchObject({ externalId: "lf-zz-063-temp-yearly-19900", price: 19900, cycle: "ANNUALLY" });
      expect(JSON.stringify(api.calls.map((c) => c.body))).not.toContain("YEARLY");
    });

    it("2a chamada reaproveita o cache: sem list e sem create", async () => {
      const { p, api } = setup();
      await p.createCheckoutSession(checkoutInput("zz-063-temp"));
      const before = api.calls.length;
      await p.createCheckoutSession(checkoutInput("zz-063-temp"));
      expect(api.calls.slice(before).map((c) => `${c.method} ${c.path}`)).toEqual(["POST /subscriptions/create"]);
    });

    it("cache perdido mas produto ja existe no provedor: acha por list, NAO cria e regrava o cache", async () => {
      const { p, api } = setup();
      api.products.set("lf-zz-063-temp-monthly-1990", { id: "prod_existing0000000000000000", externalId: "lf-zz-063-temp-monthly-1990", price: 1990, cycle: "MONTHLY", status: "ACTIVE", devMode: true });
      await p.createCheckoutSession(checkoutInput("zz-063-temp"));
      expect(api.callsTo("POST /products/create")).toHaveLength(0);
      expect((api.callsTo("POST /subscriptions/create")[0]!.body as { items: Array<{ id: string }> }).items[0]!.id).toBe("prod_existing0000000000000000");
      expect((await prisma.billingProduct.findMany({ where: { keyFingerprint: FP } }))[0]!.providerProductId).toBe("prod_existing0000000000000000");
    });

    it("preco novo = externalId novo = produto novo (produto nao tem update)", async () => {
      const { p, api } = setup();
      await p.createCheckoutSession(checkoutInput("zz-063-temp"));
      await prisma.plan.update({ where: { id: tempPlanId }, data: { priceMonthlyCents: 2490 } });
      await p.createCheckoutSession(checkoutInput("zz-063-temp"));
      expect([...api.products.keys()].sort()).toEqual(["lf-zz-063-temp-monthly-1990", "lf-zz-063-temp-monthly-2490"]);
      expect(await prisma.billingProduct.count({ where: { keyFingerprint: FP } })).toBe(2);
    });

    it("chave/ambiente diferente (outro keyFingerprint) NAO reaproveita o cache", async () => {
      const a = setup();
      await a.p.createCheckoutSession(checkoutInput("zz-063-temp"));
      const api2 = fakeAbacateApi();
      const p2 = new AbacatePayPaymentProvider({ apiKey: "outra-chave-de-api-producao-yyyyyyyy", webhookSecret: WEBHOOK_SECRET, adapter: api2.adapter, retry: false });
      await p2.createCheckoutSession(checkoutInput("zz-063-temp"));
      expect(api2.callsTo("POST /products/create")).toHaveLength(1);
      await prisma.billingProduct.deleteMany({ where: { keyFingerprint: keyFingerprintOf("outra-chave-de-api-producao-yyyyyyyy") } });
    });

    it("CONCORRENCIA: 2 checkouts simultaneos no 1o uso => so 1 create no provedor (lock + cache), 1 linha no cache, ambos usam o mesmo prod_", async () => {
      const api = fakeAbacateApi();
      // Latencia na criacao: sem serializacao as duas veriam catalogo vazio e criariam 2 produtos (o provedor real NAO e atomico: achado de dev mode).
      api.override("GET /products/list", async (c) => {
        await new Promise((r) => setTimeout(r, 40));
        const data = [...api.products.values()].filter((x) => x.externalId === c.params.externalId);
        return { status: 200, data: { success: true, data, error: null } };
      });
      const { p } = setup(api);
      const [a, b] = await Promise.all([p.createCheckoutSession(checkoutInput("zz-063-temp")), p.createCheckoutSession(checkoutInput("zz-063-temp"))]);
      expect(a.sessionId).not.toBe(b.sessionId);
      expect(api.callsTo("POST /products/create")).toHaveLength(1);
      expect(api.products.size).toBe(1);
      const ids = api.callsTo("POST /subscriptions/create").map((c) => (c.body as { items: Array<{ id: string }> }).items[0]!.id);
      expect(new Set(ids).size).toBe(1);
      expect(await prisma.billingProduct.count({ where: { keyFingerprint: FP } })).toBe(1);
    });

    it("CONCORRENCIA entre INSTANCIAS (2 providers, mesmo banco): tambem 1 so create", async () => {
      const api = fakeAbacateApi();
      api.override("GET /products/list", async (c) => {
        await new Promise((r) => setTimeout(r, 40));
        const data = [...api.products.values()].filter((x) => x.externalId === c.params.externalId);
        return { status: 200, data: { success: true, data, error: null } };
      });
      const a = setup(api).p;
      const b = setup(api).p;
      await Promise.all([a.createCheckoutSession(checkoutInput("zz-063-temp", "yearly")), b.createCheckoutSession(checkoutInput("zz-063-temp", "yearly"))]);
      expect(api.callsTo("POST /products/create")).toHaveLength(1);
      expect(await prisma.billingProduct.count({ where: { keyFingerprint: FP } })).toBe(1);
    });

    it("create recusado como duplicado (4xx) -> relista 1x e usa o existente", async () => {
      const api = fakeAbacateApi();
      let listCalls = 0;
      api.override("GET /products/list", (c) => {
        listCalls++;
        const data = listCalls === 1 ? [] : [...api.products.values()].filter((x) => x.externalId === c.params.externalId);
        return { status: 200, data: { success: true, data, error: null } };
      });
      api.products.set("lf-zz-063-temp-monthly-1990", { id: "prod_dup00000000000000000000", externalId: "lf-zz-063-temp-monthly-1990", price: 1990, cycle: "MONTHLY", status: "ACTIVE", devMode: true });
      const { p } = setup(api);
      await p.createCheckoutSession(checkoutInput("zz-063-temp"));
      expect(listCalls).toBe(2);
      expect((await prisma.billingProduct.findMany({ where: { keyFingerprint: FP } }))[0]!.providerProductId).toBe("prod_dup00000000000000000000");
    });

    it("produto existente com price/cycle DIVERGENTE -> config (nunca usa produto errado)", async () => {
      const { p, api } = setup();
      api.products.set("lf-zz-063-temp-monthly-1990", { id: "prod_bad000000000000000000000", externalId: "lf-zz-063-temp-monthly-1990", price: 999, cycle: "MONTHLY", status: "ACTIVE", devMode: true });
      expect((await fail(p.createCheckoutSession(checkoutInput("zz-063-temp")))).code).toBe("config");
      api.products.set("lf-zz-063-temp-monthly-1990", { id: "prod_bad000000000000000000000", externalId: "lf-zz-063-temp-monthly-1990", price: 1990, cycle: "ANNUALLY", status: "ACTIVE", devMode: true });
      expect((await fail(p.createCheckoutSession(checkoutInput("zz-063-temp")))).code).toBe("config");
      expect(api.callsTo("POST /subscriptions/create")).toHaveLength(0);
    });

    it("erro 401 do provedor ao criar produto NAO tenta relistar como se fosse duplicidade e e logado mascarado", async () => {
      const { p, api, logs } = setup();
      api.override("POST /products/create", () => ({ status: 401, data: { success: false, data: null, error: "Insufficient permissions" } }));
      const e = await fail(p.createCheckoutSession(checkoutInput("zz-063-temp")));
      expect(e.code).toBe("unauthorized");
      expect(api.callsTo("GET /products/list")).toHaveLength(1);
      expect(logs[0]).toBe('[abacatepay] POST /products/create -> 401 {"success":false,"data":null,"error":"Insufficient permissions"}');
    });

    it("chave de dev: fingerprint e estavel, 8 hex, e NAO contem a chave", () => {
      expect(FP).toMatch(/^[0-9a-f]{8}$/);
      expect(API_KEY).not.toContain(FP);
      expect(productExternalId("pro", "monthly", 19900)).toBe("lf-pro-monthly-19900");
    });
  });

  describe("PIX (transparents/create) — D-063-18", () => {
    it("corpo {method, data} valido no esquema estrito, SEM customer, descricao ASCII; devolve brCode/QR/expiracao", async () => {
      const { p, api } = setup();
      const r = await p.createPixCharge({ orgId: org.orgId, planKey: "starter", cadence: "monthly", customerEmail: "dono@example.com", periodEndMs: 1_790_000_000_000 });
      const call = api.callsTo("POST /transparents/create")[0]!;
      expect(transparentsCreateSchema.safeParse(call.body).success).toBe(true);
      const plan = await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } });
      expect(call.body).toEqual({
        method: "PIX",
        data: {
          amount: plan.priceMonthlyCents,
          description: "LeadForge - plano starter (mensal)",
          externalId: expect.stringMatching(new RegExp(`^lf-pix:${org.orgId}:1790000000000:[0-9a-f]{8}$`)),
          metadata: { orgId: org.orgId, planKey: "starter", cadence: "monthly" },
        },
      });
      expect(JSON.stringify(call.body)).not.toContain("dono@example.com");
      expect(r).toEqual({ chargeId: expect.stringMatching(/^pix_char_/), brCode: "00020101021126580014", brCodeBase64: "data:image/png;base64,iVBORw0K", expiresAt: new Date("2026-10-13T02:31:19.902Z") });
    });

    it("anual: usa o preco ANUAL", async () => {
      const { p, api } = setup();
      await p.createPixCharge({ orgId: org.orgId, planKey: "starter", cadence: "yearly", customerEmail: "d@e.com" });
      const plan = await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } });
      expect((api.callsTo("POST /transparents/create")[0]!.body as { data: { amount: number } }).data.amount).toBe(plan.priceYearlyCents);
    });

    it("createCheckoutSession method 'pix' devolve o campo pix e a url de retorno com session_id", async () => {
      const { p, api } = setup();
      const r = await p.createCheckoutSession({ ...checkoutInput("starter"), method: "pix" });
      expect(r.pix?.chargeId).toMatch(/^pix_char_/);
      expect(r.url).toBe(`${URLS.successUrl}?session_id=${r.sessionId}`);
      expect(api.callsTo("POST /subscriptions/create")).toHaveLength(0);
    });

    it("simulate-payment: so teste (chama a rota com ?id=) e recusado em producao", async () => {
      const { p, api } = setup();
      await p.simulatePixPayment("pix_char_abc");
      expect(api.callsTo("POST /transparents/simulate-payment")[0]!.params).toEqual({ id: "pix_char_abc" });
      process.env.VERCEL_ENV = "production";
      expect((await fail(p.simulatePixPayment("pix_char_abc"))).code).toBe("config");
      expect(api.callsTo("POST /transparents/simulate-payment")).toHaveLength(1);
    });

    it("descricao com acento/travessao e sanitizada (a API da 400 em U+2014)", async () => {
      const key = "zz-063-acentuado";
      await prisma.plan.create({ data: { key, name: "Básico — X", priceMonthlyCents: 1000, priceYearlyCents: null, active: true, selfServiceCheckout: true, limits: {} } });
      try {
        const { p, api } = setup();
        await p.createPixCharge({ orgId: org.orgId, planKey: key, cadence: "monthly", customerEmail: "d@e.com" });
        expect(transparentsCreateSchema.safeParse(api.callsTo("POST /transparents/create")[0]!.body).success).toBe(true);
      } finally {
        await prisma.plan.delete({ where: { key } });
      }
    });
  });

  describe("createPortalSession", () => {
    it("devolve erro tratado (AppError, code=config), nunca lanca excecao nao capturada, mesmo sem chamar a API", async () => {
      const { p, api } = setup();
      const e = await fail(p.createPortalSession({ orgId: org.orgId, returnUrl: "http://app.test/assinatura" }));
      expect(e).toBeInstanceOf(AppError);
      expect(e.code).toBe("config");
      expect(e.userMessage).toBe("Gestão de assinatura indisponível para este provedor.");
      expect(api.calls).toHaveLength(0);
    });
  });

  describe("verifyWebhookSignature (D-047-2: ?webhookSecret em tempo constante)", () => {
    const { p } = setup();
    it("secret correto -> true", () => expect(p.verifyWebhookSignature("{}", WEBHOOK_SECRET)).toBe(true));
    it("secret errado -> false", () => expect(p.verifyWebhookSignature("{}", "secret-errado-mas-mesmo-tamanho-aaaaaaaaaa")).toBe(false));
    it("secret ausente (null) -> false", () => expect(p.verifyWebhookSignature("{}", null)).toBe(false));
    it("secret de tamanho diferente -> false (sem lançar)", () => expect(p.verifyWebhookSignature("{}", "curto")).toBe(false));
  });

  describe("erros de rede", () => {
    it("falha de rede e relancada sem corpo logado (so metodo/path/sem-resposta)", async () => {
      const logs: string[] = [];
      const p = new AbacatePayPaymentProvider({
        apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET, retry: false, errorLog: (l) => logs.push(l),
        adapter: async (config) => { throw new AxiosError("boom", "ECONNRESET", config); },
      });
      const e = await fail(p.createPixCharge({ orgId: org.orgId, planKey: "starter", cadence: "monthly", customerEmail: "d@e.com" }));
      expect(e.code).toBe("network");
      expect(logs[0]).toBe("[abacatepay] POST /transparents/create -> sem-resposta ECONNRESET");
    });
  });
});
