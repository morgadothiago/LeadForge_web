import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { getBillingHistory } from "./billing-history";
import { BILLING_HISTORY_PAGE_SIZE, decodeCursor, encodeCursor, loadBillingHistory } from "@/lib/billing/billing-history-core";

/** SPEC-066a — leitura do historico: cursor, filtros, resumo, derivacoes (overdue/canceled/proxima prevista), permissao e isolamento A/B/C. */

let A: TestOrg;
let B: TestOrg;
let C: TestOrg;
let memberId: string;
let outsiderId: string;
let planId: string;
let starterPrices: { m: number; y: number | null };
const NOW = new Date("2026-06-15T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 24 * 3600_000);

async function charge(orgId: string, over: Partial<Prisma.BillingChargeUncheckedCreateInput> = {}) {
  return prisma.billingCharge.create({
    data: { orgId, provider: "abacatepay", externalId: `zz-${randomUUID()}`, amountCents: 2990, status: "paid", method: "card", planKey: "starter", cadence: "monthly", dueAt: day(-30), paidAt: day(-30), ...over },
  });
}
const sub = (orgId: string, data: Partial<Prisma.SubscriptionUncheckedCreateInput> = {}) =>
  prisma.subscription.create({ data: { orgId, planId, status: "active", cadence: "monthly", currentPeriodEnd: day(10), ...data } });

beforeAll(async () => {
  A = await createTestOrg("bh-a");
  B = await createTestOrg("bh-b");
  C = await createTestOrg("bh-c");
  memberId = randomUUID();
  outsiderId = randomUUID();
  for (const [id, tag] of [[memberId, "member"], [outsiderId, "outsider"]] as const) {
    await prisma.user.create({ data: { id, name: `zz ${tag}`, email: `zz-bh-${tag}-${id.slice(0, 8)}@test.local`, role: "provider" } });
  }
  await prisma.membership.create({ data: { userId: memberId, orgId: A.orgId, orgRole: "member" } });
  const plan = await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } });
  planId = plan.id;
  starterPrices = { m: plan.priceMonthlyCents, y: plan.priceYearlyCents };
});
afterEach(async () => {
  signOut();
  for (const o of [A, B, C]) {
    await prisma.billingCharge.deleteMany({ where: { orgId: o.orgId } });
    await prisma.subscription.deleteMany({ where: { orgId: o.orgId } });
  }
});
afterAll(async () => {
  await prisma.membership.deleteMany({ where: { userId: { in: [memberId, outsiderId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [memberId, outsiderId] } } });
  for (const o of [A, B, C]) await purgeTestOrg(o);
});

describe("cursor e ordem", () => {
  it("pagina por (createdAt desc, id desc) sem repeticao nem lacuna, mesmo com createdAt IGUAL", async () => {
    const same = new Date("2026-05-01T10:00:00.000Z");
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push((await charge(A.orgId, { createdAt: i < 20 ? same : new Date(same.getTime() + i * 1000) })).id);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const p = await loadBillingHistory({ orgId: A.orgId, cursor, now: NOW });
      expect(p.items.length).toBeLessThanOrEqual(BILLING_HISTORY_PAGE_SIZE);
      seen.push(...p.items.map((i) => i.id));
      cursor = p.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
    expect([...seen].sort()).toEqual([...ids].sort());
    const rows = await prisma.billingCharge.findMany({ where: { orgId: A.orgId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    expect(seen).toEqual(rows.map((r) => r.id));
  });

  it("cursor invalido -> erro de validacao; encode/decode e simetrico", async () => {
    await expect(loadBillingHistory({ orgId: A.orgId, cursor: "###", now: NOW })).rejects.toThrow();
    await expect(loadBillingHistory({ orgId: A.orgId, cursor: Buffer.from("nao-e-data|x").toString("base64url"), now: NOW })).rejects.toThrow();
    const d = new Date("2026-01-02T03:04:05.678Z");
    expect(decodeCursor(encodeCursor(d, "abc"))).toEqual({ createdAt: d, id: "abc" });
  });
});

describe("filtros e derivacao de status", () => {
  it("overdue = pending com dueAt vencido (relogio injetado); pending futuro continua pending", async () => {
    await sub(A.orgId, { status: "past_due", pastDueSince: day(-2) });
    await charge(A.orgId, { status: "pending", method: "pix", dueAt: day(-1), paidAt: null, externalId: "p-over" });
    await charge(A.orgId, { status: "pending", method: "pix", dueAt: day(3), paidAt: null, externalId: "p-fut" });
    const r = await loadBillingHistory({ orgId: A.orgId, now: NOW });
    const byId = (id: string) => r.items.find((i) => i.id === id);
    const rows = await prisma.billingCharge.findMany({ where: { orgId: A.orgId } });
    const over = rows.find((x) => x.externalId === "p-over")!;
    const fut = rows.find((x) => x.externalId === "p-fut")!;
    expect(byId(over.id)!.status).toBe("overdue");
    expect(byId(fut.id)!.status).toBe("pending");
    // mudar o relogio muda a derivacao, sem gravar nada
    const later = await loadBillingHistory({ orgId: A.orgId, now: day(10) });
    expect(later.items.find((i) => i.id === fut.id)!.status).toBe("overdue");
    expect((await prisma.billingCharge.findUniqueOrThrow({ where: { id: fut.id } })).status).toBe("pending");
  });

  it("filtros: open / paid / problems", async () => {
    await sub(A.orgId);
    const paid = await charge(A.orgId, { status: "paid" });
    const pend = await charge(A.orgId, { status: "pending", dueAt: day(5), paidAt: null });
    const over = await charge(A.orgId, { status: "pending", dueAt: day(-5), paidAt: null });
    const failed = await charge(A.orgId, { status: "failed", paidAt: null });
    const refunded = await charge(A.orgId, { status: "refunded" });
    const ids = async (filter: "all" | "open" | "paid" | "problems") => (await loadBillingHistory({ orgId: A.orgId, filter, now: NOW })).items.map((i) => i.id).sort();
    expect(await ids("paid")).toEqual([paid.id]);
    expect(await ids("open")).toEqual([pend.id, over.id, failed.id].sort());
    expect(await ids("problems")).toEqual([over.id, failed.id, refunded.id].sort());
    expect(await ids("all")).toHaveLength(5);
    // filtro desconhecido cai em "all"
    const weird = await loadBillingHistory({ orgId: A.orgId, filter: "xx" as never, now: NOW });
    expect(weird.items).toHaveLength(5);
  });

  it("org cancelada: pendentes viram canceled na leitura (nunca overdue); sem atraso no resumo", async () => {
    await sub(A.orgId, { status: "canceled", canceledAt: day(-1) });
    const pend = await charge(A.orgId, { status: "pending", dueAt: day(-5), paidAt: null });
    const r = await loadBillingHistory({ orgId: A.orgId, now: NOW });
    expect(r.items.find((i) => i.id === pend.id)!.status).toBe("canceled");
    expect(r.summary.overdue).toBeNull();
    expect(r.summary.next).toBeNull();
    const open = await loadBillingHistory({ orgId: A.orgId, filter: "open", now: NOW });
    expect(open.items).toHaveLength(0);
  });
});

describe("resumo", () => {
  it("total pago soma so paid (sem refunded/failed/pending), independe de filtro/pagina", async () => {
    await sub(A.orgId);
    await charge(A.orgId, { amountCents: 1000 });
    await charge(A.orgId, { amountCents: 2000 });
    await charge(A.orgId, { amountCents: 9999, status: "refunded" });
    await charge(A.orgId, { amountCents: 7777, status: "failed" });
    const r = await loadBillingHistory({ orgId: A.orgId, filter: "problems", now: NOW });
    expect(r.summary.totalPaidCents).toBe(3000);
  });

  it("proxima mensalidade projetada na leitura (plano x cadencia, vencimento = currentPeriodEnd), sem gravar; anual usa preco anual", async () => {
    await sub(A.orgId);
    const r = await loadBillingHistory({ orgId: A.orgId, now: NOW });
    expect(r.summary.next).toMatchObject({ amountCents: starterPrices.m, predicted: true, planKey: "starter", cadence: "monthly" });
    expect(r.summary.next!.dueAt).toEqual(day(10));
    expect(await prisma.billingCharge.count({ where: { orgId: A.orgId } })).toBe(0);
    if (starterPrices.y) {
      await prisma.subscription.update({ where: { orgId: A.orgId }, data: { cadence: "yearly" } });
      const y = await loadBillingHistory({ orgId: A.orgId, now: NOW });
      expect(y.summary.next).toMatchObject({ amountCents: starterPrices.y, cadence: "yearly" });
    }
  });

  it("proxima mensalidade ancorada no dia do 1o pagamento (corrige a deriva do currentPeriodEnd: 28/03 -> 31/03)", async () => {
    await sub(A.orgId, { currentPeriodEnd: new Date("2026-03-28T15:00:00Z") });
    await charge(A.orgId, { paidAt: new Date("2026-01-31T15:00:00Z"), dueAt: new Date("2026-01-31T15:00:00Z") });
    const r = await loadBillingHistory({ orgId: A.orgId, now: new Date("2026-03-01T12:00:00Z") });
    expect(r.summary.next!.dueAt).toEqual(new Date("2026-03-31T15:00:00Z"));
  });

  it("cancelAtPeriodEnd, trialing ou sem assinatura: sem projecao", async () => {
    await sub(A.orgId, { cancelAtPeriodEnd: true });
    expect((await loadBillingHistory({ orgId: A.orgId, now: NOW })).summary.next).toBeNull();
    await prisma.subscription.update({ where: { orgId: A.orgId }, data: { cancelAtPeriodEnd: false, status: "trialing" } });
    expect((await loadBillingHistory({ orgId: A.orgId, now: NOW })).summary.next).toBeNull();
    expect((await loadBillingHistory({ orgId: B.orgId, now: NOW })).summary.next).toBeNull();
  });

  it("linha pending REAL substitui a projecao (predicted=false)", async () => {
    await sub(A.orgId);
    await charge(A.orgId, { status: "pending", method: "pix", dueAt: day(2), amountCents: 1234, paidAt: null });
    const r = await loadBillingHistory({ orgId: A.orgId, now: NOW });
    expect(r.summary.next).toMatchObject({ amountCents: 1234, predicted: false, method: "pix" });
    expect(r.summary.next!.dueAt).toEqual(day(2));
  });

  it("em atraso: conta pendentes vencidas + falhas; since = pastDueSince; graceEndsAt = +7 dias", async () => {
    await sub(A.orgId, { status: "past_due", pastDueSince: day(-3) });
    await charge(A.orgId, { status: "failed", amountCents: 3000, paidAt: null, dueAt: day(-3) });
    await charge(A.orgId, { status: "pending", method: "pix", amountCents: 500, dueAt: day(-1), paidAt: null });
    await charge(A.orgId, { status: "pending", method: "pix", amountCents: 700, dueAt: day(4), paidAt: null });
    const r = await loadBillingHistory({ orgId: A.orgId, now: NOW });
    expect(r.summary.overdue).toMatchObject({ count: 2, totalCents: 3500 });
    expect(r.summary.overdue!.since).toEqual(day(-3));
    expect(r.summary.overdue!.graceEndsAt).toEqual(day(4));
  });

  it("org Free/sem cobrancas: vazio, hasAnyCharge false, total 0", async () => {
    const r = await loadBillingHistory({ orgId: C.orgId, now: NOW });
    expect(r).toMatchObject({ items: [], nextCursor: null, hasAnyCharge: false });
    expect(r.summary).toEqual({ totalPaidCents: 0, next: null, overdue: null });
  });
});

describe("getBillingHistory (sessao, permissao e isolamento)", () => {
  it("sem sessao -> lanca", async () => {
    await expect(getBillingHistory()).rejects.toThrow();
  });

  it("owner E member leem os valores; isOwner reflete o papel", async () => {
    await charge(A.orgId, { amountCents: 4242 });
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const owner = await getBillingHistory({}, NOW);
    expect(owner.isOwner).toBe(true);
    expect(owner.items[0]!.amountCents).toBe(4242);
    signOut();
    await signInAs(memberId, { orgId: A.orgId, platformRole: "provider" });
    const member = await getBillingHistory({}, NOW);
    expect(member.isOwner).toBe(false);
    expect(member.items[0]!.amountCents).toBe(4242);
    expect(member.summary.totalPaidCents).toBe(4242);
  });

  it("usuario sem vinculo com a org da sessao -> recusado", async () => {
    await charge(A.orgId);
    await signInAs(outsiderId, { orgId: A.orgId, platformRole: "provider" });
    await expect(getBillingHistory({}, NOW)).rejects.toThrow();
  });

  it("platform_admin (sem org) -> recusado", async () => {
    await signInAs(A.userId, { orgId: null, platformRole: "platform_admin" });
    await expect(getBillingHistory({}, NOW)).rejects.toThrow();
  });

  it("A, B e C: cada org ve SO as proprias cobrancas e o proprio total (itens, cursor e resumo)", async () => {
    await charge(A.orgId, { amountCents: 100 });
    await charge(B.orgId, { amountCents: 20_000 });
    await charge(B.orgId, { amountCents: 30_000, status: "failed" });
    const aRow = await prisma.billingCharge.findFirstOrThrow({ where: { orgId: A.orgId } });
    for (const [o, expectedItems, paid] of [[A, 1, 100], [B, 2, 20_000], [C, 0, 0]] as const) {
      signOut();
      await signInAs(o.userId, { orgId: o.orgId, platformRole: "provider" });
      const r = await getBillingHistory({}, NOW);
      expect(r.items).toHaveLength(expectedItems);
      expect(r.summary.totalPaidCents).toBe(paid);
      if (o !== A) expect(r.items.map((i) => i.id)).not.toContain(aRow.id);
    }
    // cursor de A usado na sessao de B nao vaza nada de A
    const cursorA = encodeCursor(new Date(Date.now() + 1000), "zzzz");
    signOut();
    await signInAs(B.userId, { orgId: B.orgId, platformRole: "provider" });
    const withForeignCursor = await getBillingHistory({ cursor: cursorA }, NOW);
    expect(withForeignCursor.items.every((i) => i.id !== aRow.id)).toBe(true);
  });

  it("DTO nao expoe orgId, externalId, subscriptionId nem provider", async () => {
    await charge(A.orgId);
    const r = await loadBillingHistory({ orgId: A.orgId, now: NOW });
    const keys = Object.keys(r.items[0]!);
    for (const k of ["orgId", "externalId", "subscriptionId", "provider", "failureReason"]) expect(keys).not.toContain(k);
  });
});
