import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { POST } from "@/app/api/billing/webhook/route";
import { MockPaymentProvider } from "./providers/mock";
import { handleBillingWebhook } from "./webhook-handler";
import type { PaymentProvider } from "./provider";

const SECRET = "zz-mock-webhook-secret-32-chars-minimo-xyz";

let org: TestOrg;
// PAYMENT_PROVIDER=mock (default do projeto) agora exige Authorization: Bearer MOCK_WEBHOOK_SECRET (QA fix,
// achado crítico) — `call()` já inclui o Bearer válido por padrão; testes de auth sobrescrevem os headers.
const call = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://app.test/api/billing/webhook", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { authorization: `Bearer ${SECRET}`, ...headers },
    }),
  );

const validPayload = () => ({
  eventId: `zz-evt-${randomUUID()}`,
  type: "subscription.created",
  orgId: org.orgId,
  planKey: "starter",
  cadence: "monthly",
  status: "active",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  externalCustomerId: null,
  externalSubscriptionId: null,
});

beforeAll(async () => {
  process.env.MOCK_WEBHOOK_SECRET = SECRET;
  org = await createTestOrg("billing-webhook");
});
afterEach(async () => {
  await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
  await prisma.webhookEvent.deleteMany({ where: { orgId: org.orgId } });
});
afterAll(async () => {
  delete process.env.MOCK_WEBHOOK_SECRET;
  await purgeTestOrg(org);
});

describe("POST /api/billing/webhook (SPEC-033, PAYMENT_PROVIDER=mock por default)", () => {
  it("evento válido: 200, processado, Organization.status refletido", async () => {
    const res = await call(validPayload());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, result: "processed" });
    const o = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
    expect(o.status).toBe("active");
  });

  it("evento duplicado (mesmo eventId): 200 'duplicate', não reaplica", async () => {
    const payload = validPayload();
    await call(payload);
    const res2 = await call(payload);
    expect(res2.status).toBe(200);
    expect((await res2.json()).result).toBe("duplicate");
  });

  it("payload inválido (JSON malformado): 400, sem vazar detalhe interno", async () => {
    const res = await call("{ isso não é json");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).not.toMatch(/SyntaxError|at JSON.parse/);
  });

  it("payload com forma inválida (faltando orgId): 400", async () => {
    const { orgId: _omit, ...rest } = validPayload();
    const res = await call(rest);
    expect(res.status).toBe(400);
  });

  it("evento de tipo desconhecido (fora do vocabulário): 200 'ignored', sem tocar no banco", async () => {
    const res = await call({ ...validPayload(), type: "invoice.created" });
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBe("ignored");
  });

  it("org inexistente: 200 'org_not_found' (nunca 500; evita retry-storm do provedor)", async () => {
    const res = await call({ ...validPayload(), orgId: randomUUID() });
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBe("org_not_found");
  });

  it("assinatura inválida (provider fake que recusa): 401, corpo não vaza segredo", async () => {
    const fakeProvider: PaymentProvider = {
      name: "stripe",
      async createCheckoutSession() {
        throw new Error("not used");
      },
      async createPortalSession() {
        throw new Error("not used");
      },
      verifyWebhookSignature: () => false,
      parseWebhookEvent: () => null,
    };
    const res = await handleBillingWebhook(new Request("http://app.test/api/billing/webhook", { method: "POST", body: JSON.stringify(validPayload()), headers: { "stripe-signature": "forjada" } }), {
      provider: fakeProvider,
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/forjada|secret|chave/i);
  });

  it("assinatura válida (mock, default): sempre true, mesmo parser/handler exercitado", async () => {
    const provider = new MockPaymentProvider();
    expect(provider.verifyWebhookSignature("{}", null)).toBe(true);
  });

  describe("QA fix (achado crítico, rodada 2) — PAYMENT_PROVIDER=mock não aceita evento HTTP não autenticado", () => {
    it("sem Authorization: 401, Organization.status nunca muda (mesmo com orgId real)", async () => {
      const before = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
      const res = await call({ ...validPayload(), status: "canceled" }, { authorization: "" });
      expect(res.status).toBe(401);
      const after = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
      expect(after.status).toBe(before.status);
      expect(await prisma.subscription.findUnique({ where: { orgId: org.orgId } })).toBeNull();
    });

    it("Authorization com segredo errado: 401, Organization.status nunca muda", async () => {
      const before = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
      const res = await call({ ...validPayload(), status: "canceled" }, { authorization: "Bearer segredo-forjado-qualquer-coisa-aqui" });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(JSON.stringify(body)).not.toMatch(new RegExp(SECRET, "i"));
      const after = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
      expect(after.status).toBe(before.status);
    });

    it("MOCK_WEBHOOK_SECRET não configurado: 503 'not_configured' (nunca aberto por omissão)", async () => {
      delete process.env.MOCK_WEBHOOK_SECRET;
      try {
        const res = await call(validPayload());
        expect(res.status).toBe(503);
        expect((await res.json()).error).toBe("not_configured");
      } finally {
        process.env.MOCK_WEBHOOK_SECRET = SECRET;
      }
    });

    it("Authorization correto: evento é processado normalmente (comportamento base preservado)", async () => {
      const res = await call(validPayload());
      expect(res.status).toBe(200);
      expect((await res.json()).result).toBe("processed");
    });
  });

  it("todos os status de transição do mapeamento são exercitados pelo webhook: trialing/active/past_due/canceled/incomplete", async () => {
    for (const status of ["trialing", "active", "past_due", "canceled", "incomplete"] as const) {
      const res = await call({ ...validPayload(), status });
      expect(res.status, status).toBe(200);
      expect((await res.json()).result, status).toBe("processed");
    }
  });
});
