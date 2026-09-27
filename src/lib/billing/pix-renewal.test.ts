import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AxiosAdapter } from "axios";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { resetPaymentProviderCache } from "./provider-factory";
import { AbacatePayPaymentProvider } from "./providers/abacatepay";
import { runPixRenewalJob } from "./pix-renewal";

/**
 * SPEC-047 (D-047-1) — job de renovação PIX. Provider injetado (adapter axios mockado): nunca chama a
 * API real do AbacatePay. Cobre especificamente os cenários pedidos pela SPEC: geração de cobrança nova
 * a cada ciclo, PIX vencido sem pagamento transicionando para `past_due` via `status-map.ts` (não um
 * caminho paralelo), e idempotência via `processBillingEvent`/`WebhookEvent.eventId`.
 */

let org: TestOrg;
let planId: string;
const NOW = new Date("2026-09-27T12:00:00Z");

beforeAll(async () => {
  org = await createTestOrg("pix-renewal");
  planId = (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" }, select: { id: true } })).id;
});
afterEach(async () => {
  await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
  await prisma.webhookEvent.deleteMany({ where: { orgId: org.orgId } });
});
afterAll(() => purgeTestOrg(org));

function providerWith(steps: Array<{ status: number; data?: unknown }>) {
  let i = 0;
  const adapter: AxiosAdapter = async (config) => {
    const s = steps[Math.min(i, steps.length - 1)]!;
    i++;
    return { data: s.data ?? {}, status: s.status, statusText: "", headers: {}, config, request: {} };
  };
  return new AbacatePayPaymentProvider({ apiKey: "k", webhookSecret: "s", adapter, retry: false });
}

async function makeSub(overrides: Partial<Prisma.SubscriptionUncheckedCreateInput> = {}) {
  return prisma.subscription.create({
    data: {
      orgId: org.orgId, planId, status: "active", cadence: "monthly", pixManaged: true,
      currentPeriodEnd: new Date(NOW.getTime() - 60_000), // vencido
      ...overrides,
    },
  });
}

describe("runPixRenewalJob (SPEC-047, D-047-1)", () => {
  it("sem injectedProvider e PAYMENT_PROVIDER=mock (default do projeto) -> resolve mock via getPaymentProvider() e é no-op, mesmo com Subscription pixManaged vencida", async () => {
    await makeSub();
    resetPaymentProviderCache();
    const prevProvider = process.env.PAYMENT_PROVIDER;
    delete process.env.PAYMENT_PROVIDER; // default "mock"
    try {
      const r = await runPixRenewalJob(NOW);
      expect(r).toEqual({ generated: 0, markedPastDue: 0, errors: 0 });
    } finally {
      if (prevProvider === undefined) delete process.env.PAYMENT_PROVIDER;
      else process.env.PAYMENT_PROVIDER = prevProvider;
      resetPaymentProviderCache();
    }
  });

  it("PAYMENT_PROVIDER=abacatepay sem ABACATEPAY_API_KEY/WEBHOOK_SECRET configurados -> getPaymentProvider() lança, job trata como no-op (nunca derruba o tick)", async () => {
    await makeSub();
    resetPaymentProviderCache();
    const prev = { provider: process.env.PAYMENT_PROVIDER, key: process.env.ABACATEPAY_API_KEY, secret: process.env.ABACATEPAY_WEBHOOK_SECRET };
    process.env.PAYMENT_PROVIDER = "abacatepay";
    delete process.env.ABACATEPAY_API_KEY;
    delete process.env.ABACATEPAY_WEBHOOK_SECRET;
    try {
      const r = await runPixRenewalJob(NOW);
      expect(r).toEqual({ generated: 0, markedPastDue: 0, errors: 0 });
    } finally {
      prev.provider === undefined ? delete process.env.PAYMENT_PROVIDER : (process.env.PAYMENT_PROVIDER = prev.provider);
      prev.key === undefined ? delete process.env.ABACATEPAY_API_KEY : (process.env.ABACATEPAY_API_KEY = prev.key);
      prev.secret === undefined ? delete process.env.ABACATEPAY_WEBHOOK_SECRET : (process.env.ABACATEPAY_WEBHOOK_SECRET = prev.secret);
      resetPaymentProviderCache();
    }
  });

  it("ciclo ainda não vencido -> nada a fazer (nem gera cobrança nem marca past_due)", async () => {
    await makeSub({ currentPeriodEnd: new Date(NOW.getTime() + 10 * 24 * 3600_000) });
    const provider = providerWith([]);
    const r = await runPixRenewalJob(NOW, provider);
    expect(r).toEqual({ generated: 0, markedPastDue: 0, errors: 0 });
  });

  it("ciclo vencido, sem cobrança pendente -> gera uma nova cobrança PIX (transparents/create) e grava pixChargeId/pixChargeExpiresAt", async () => {
    const sub = await makeSub();
    const provider = providerWith([{ status: 200, data: { data: { id: "pix_new_1", brCode: "000201...", brCodeBase64: "b64", expiresAt: "2026-09-28T00:00:00Z" } } }]);
    const r = await runPixRenewalJob(NOW, provider);
    expect(r).toEqual({ generated: 1, markedPastDue: 0, errors: 0 });
    const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(updated.pixChargeId).toBe("pix_new_1");
    expect(updated.pixChargeExpiresAt).toEqual(new Date("2026-09-28T00:00:00Z"));
    expect(updated.status).toBe("active"); // ainda não marcou past_due nesta rodada (cobrança acabou de ser gerada)
  });

  it("cobrança pendente ainda dentro da validade -> não gera outra nem marca past_due (aguarda o webhook)", async () => {
    await makeSub({ pixChargeId: "pix_pending", pixChargeExpiresAt: new Date(NOW.getTime() + 3600_000) });
    const provider = providerWith([]);
    const r = await runPixRenewalJob(NOW, provider);
    expect(r).toEqual({ generated: 0, markedPastDue: 0, errors: 0 });
  });

  it("PIX vencido sem pagamento -> vira past_due pelo MESMO status-map.ts (processBillingEvent), não um caminho paralelo, e limpa pixChargeId/pixChargeExpiresAt", async () => {
    const sub = await makeSub({ pixChargeId: "pix_expired_1", pixChargeExpiresAt: new Date(NOW.getTime() - 60_000) });
    const provider = providerWith([]);
    const r = await runPixRenewalJob(NOW, provider);
    expect(r).toEqual({ generated: 0, markedPastDue: 1, errors: 0 });

    const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(updated.status).toBe("past_due");
    expect(updated.pastDueSince).not.toBeNull();
    expect(updated.pixChargeId).toBeNull();
    expect(updated.pixChargeExpiresAt).toBeNull();

    const orgRow = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
    expect(orgRow.status).toBe("active"); // grace period de 7 dias (status-map.ts) ainda não expirou -> org continua ativa.

    // Passou pelo MESMO WebhookEvent/idempotência do resto do fluxo de billing (SPEC-033), não um mecanismo paralelo.
    const event = await prisma.webhookEvent.findUnique({ where: { eventId: "abacatepay_pix_expired_pix_expired_1" } });
    expect(event?.source).toBe("billing");
  });

  it("idempotência: rodar de novo no mesmo tick (retry) não duplica o efeito (eventId já processado -> 'duplicate', sem re-marcar)", async () => {
    await makeSub({ pixChargeId: "pix_expired_2", pixChargeExpiresAt: new Date(NOW.getTime() - 60_000) });
    const provider = providerWith([]);
    const r1 = await runPixRenewalJob(NOW, provider);
    expect(r1.markedPastDue).toBe(1);
    // pixChargeId já foi limpo pela 1ª rodada -> a 2ª rodada, no MESMO ciclo vencido, tenta GERAR uma nova cobrança (não re-marcar past_due).
    const provider2 = providerWith([{ status: 200, data: { data: { id: "pix_retry", brCode: "x", brCodeBase64: "y", expiresAt: "2026-09-28T00:00:00Z" } } }]);
    const r2 = await runPixRenewalJob(NOW, provider2);
    expect(r2).toEqual({ generated: 1, markedPastDue: 0, errors: 0 });
  });

  it("webhook confirma pagamento (currentPeriodEnd avança além da validade da cobrança) -> próxima rodada não marca past_due com a cobrança antiga (evita falso positivo)", async () => {
    // Simula o efeito do webhook transparent.completed: currentPeriodEnd avançou 1 ciclo, mas pixChargeId/pixChargeExpiresAt
    // ainda são os da cobrança JÁ PAGA (processBillingEvent genérico não mexe nesses 2 campos, só o job faz).
    const sub = await makeSub({
      currentPeriodEnd: new Date(NOW.getTime() + 29 * 24 * 3600_000), // pago, novo período no futuro
      pixChargeId: "pix_already_paid",
      pixChargeExpiresAt: new Date(NOW.getTime() - 24 * 3600_000), // validade antiga, já expirada
    });
    const provider = providerWith([]);
    const r = await runPixRenewalJob(NOW, provider);
    expect(r).toEqual({ generated: 0, markedPastDue: 0, errors: 0 }); // ciclo NÃO vencido (currentPeriodEnd no futuro) -> nem olha pixChargeId.
    const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(updated.status).toBe("active");
  });

  it("cobrança pendente sem owner cadastrado -> pulado (sem lançar, sem gerar cobrança)", async () => {
    // org sem membership 'owner' pra este teste especifico: cria uma org isolada sem membership.
    const { randomUUID } = await import("node:crypto");
    const orphanOrgId = randomUUID();
    await prisma.organization.create({ data: { id: orphanOrgId, name: "zz-orphan", slug: `zz-orphan-${orphanOrgId.slice(0, 8)}`, status: "active" } });
    await prisma.subscription.create({ data: { orgId: orphanOrgId, planId, status: "active", cadence: "monthly", pixManaged: true, currentPeriodEnd: new Date(NOW.getTime() - 60_000) } });
    const provider = providerWith([]);
    const r = await runPixRenewalJob(NOW, provider);
    expect(r.errors).toBe(0);
    expect(r.generated).toBe(0);
    await prisma.subscription.deleteMany({ where: { orgId: orphanOrgId } });
    await prisma.organization.deleteMany({ where: { id: orphanOrgId } });
  });

  it("erro ao chamar a API (ex.: rede) é isolado por org -- não derruba o job inteiro, contabiliza em errors", async () => {
    await makeSub();
    const provider = new AbacatePayPaymentProvider({
      apiKey: "k", webhookSecret: "s", retry: false,
      adapter: async () => {
        throw new Error("boom");
      },
    });
    const r = await runPixRenewalJob(NOW, provider);
    expect(r.errors).toBe(1);
    expect(r.generated).toBe(0);
  });

  it("Subscription não-pixManaged (ex.: cartão AbacatePay ou mock/stripe) nunca é tocada pelo job", async () => {
    const sub = await prisma.subscription.create({
      data: { orgId: org.orgId, planId, status: "active", cadence: "monthly", pixManaged: false, currentPeriodEnd: new Date(NOW.getTime() - 60_000) },
    });
    const provider = providerWith([]);
    const r = await runPixRenewalJob(NOW, provider);
    expect(r).toEqual({ generated: 0, markedPastDue: 0, errors: 0 });
    const untouched = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(untouched.pixChargeId).toBeNull();
  });
});
