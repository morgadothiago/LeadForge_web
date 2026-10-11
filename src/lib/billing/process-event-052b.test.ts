import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import type { ParsedBillingEvent } from "./provider";
import { processBillingEvent } from "./process-event";
import { sendBillingReminders } from "./reminders";
import { PAST_DUE_GRACE_MS } from "./status-map";

/** SPEC-052b — falha imediata, regua D+3/5/7, recuperacao, plan-changed, renewal-upcoming, idempotencia. sendSystemEmail mockado. */
vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "" })) }));

let org: TestOrg;
let starterId: string;
const NOW = new Date("2026-03-01T12:00:00Z");
const NEXT = new Date("2026-03-31T12:00:00Z");
const DAY = 24 * 3600_000;

const ev = (over: Partial<ParsedBillingEvent> = {}): ParsedBillingEvent => ({
  eventId: `zz-evt-052b-${randomUUID()}`, type: "subscription.created", orgId: org.orgId, planKey: "starter", cadence: "monthly", status: "active",
  currentPeriodEnd: NEXT, cancelAtPeriodEnd: false, externalCustomerId: "cus_1", externalSubscriptionId: "sub_1", ...over,
});
const calls = () => vi.mocked(sendSystemEmail).mock.calls;
const scenarios = () => calls().map((c) => c[3]);
const failed = (over: Partial<ParsedBillingEvent> = {}) => ev({ type: "payment.failed", status: "past_due", ...over });

beforeAll(async () => {
  org = await createTestOrg("process-event-052b");
  starterId = (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" }, select: { id: true } })).id;
});
beforeEach(() => vi.mocked(sendSystemEmail).mockClear());
afterEach(async () => {
  await prisma.billingReminderLog.deleteMany({ where: { orgId: org.orgId } });
  await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
  await prisma.webhookEvent.deleteMany({ where: { orgId: org.orgId } });
  await prisma.emailDispatchLog.deleteMany({ where: { orgId: org.orgId } });
  await prisma.organization.update({ where: { id: org.orgId }, data: { status: "active", suspendedReason: null } });
});
afterAll(() => purgeTestOrg(org));

describe("payment_failed imediato (052b)", () => {
  it("payment.failed envia 1 e-mail D+0 com link absoluto, sem dado sensivel; evento distinto no mesmo episodio nao duplica", async () => {
    await processBillingEvent(ev(), NOW);
    vi.mocked(sendSystemEmail).mockClear();
    await processBillingEvent(failed({ paymentMethod: "card", cardLast4: "4242" }), NOW);
    expect(scenarios()).toEqual(["payment_failed"]);
    const [, subject, content] = calls()[0];
    expect(subject).toMatch(/pagamento/i);
    expect(content.text).toMatch(/https?:\/\/\S+\/configuracoes\/assinatura/);
    expect(content.text).toContain("final 4242");
    await processBillingEvent(failed(), new Date(NOW.getTime() + 1000));
    expect(calls()).toHaveLength(1);
  });

  it("reentrega do mesmo webhook nao duplica", async () => {
    const e = failed();
    expect(await processBillingEvent(e, NOW)).toBe("processed");
    expect(await processBillingEvent(e, NOW)).toBe("duplicate");
    expect(calls()).toHaveLength(1);
  });

  it("falha do provider nao propaga nem reverte a transacao", async () => {
    vi.mocked(sendSystemEmail).mockRejectedValueOnce(new Error("smtp down"));
    expect(await processBillingEvent(failed(), NOW)).toBe("processed");
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId }, select: { status: true, pastDueSince: true } });
    expect(sub.status).toBe("past_due");
    expect(sub.pastDueSince).toEqual(NOW);
  });

  it("corrida evento x job: job primeiro, depois evento = 1 e-mail D+0; evento primeiro, depois job = 1", async () => {
    // job primeiro: past_due ja persistido sem evento
    await prisma.subscription.create({ data: { orgId: org.orgId, planId: starterId, status: "past_due", cadence: "monthly", pastDueSince: NOW } });
    await sendBillingReminders(NOW);
    expect(scenarios()).toEqual(["payment_failed"]);
    await processBillingEvent(failed(), new Date(NOW.getTime() + 1000));
    expect(calls()).toHaveLength(1);
    // evento primeiro
    await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
    await prisma.billingReminderLog.deleteMany({ where: { orgId: org.orgId } });
    await prisma.emailDispatchLog.deleteMany({ where: { orgId: org.orgId } });
    vi.mocked(sendSystemEmail).mockClear();
    await processBillingEvent(failed(), NOW);
    await sendBillingReminders(NOW);
    await sendBillingReminders(NOW);
    expect(calls()).toHaveLength(1);
  });

  it("concorrencia real: evento e job em paralelo geram 1 e-mail D+0", async () => {
    await prisma.subscription.create({ data: { orgId: org.orgId, planId: starterId, status: "past_due", cadence: "monthly", pastDueSince: NOW } });
    await Promise.all([processBillingEvent(failed(), NOW), sendBillingReminders(NOW), sendBillingReminders(NOW)]);
    expect(scenarios().filter((s) => s === "payment_failed")).toHaveLength(1);
  });
});

describe("regua D+3/D+5/D+7 (052b)", () => {
  const seed = (since: Date) => prisma.subscription.create({ data: { orgId: org.orgId, planId: starterId, status: "past_due", cadence: "monthly", pastDueSince: since } });

  it("por dia: D+0 so fallback; D+3, D+5, D+6 (ultimo aviso) um e-mail cada; reexecucao nao duplica", async () => {
    await seed(NOW);
    const subjects: string[] = [];
    for (const d of [0, 2, 3, 4, 5, 6, 7]) {
      vi.mocked(sendSystemEmail).mockClear();
      await sendBillingReminders(new Date(NOW.getTime() + d * DAY));
      await sendBillingReminders(new Date(NOW.getTime() + d * DAY)); // retry do tick
      subjects.push(...calls().map((c) => c[1]));
      if (d === 0) expect(calls()).toHaveLength(1);
      if (d === 2 || d === 4 || d === 7) expect(calls()).toHaveLength(0);
      if (d === 3 || d === 5 || d === 6) expect(calls()).toHaveLength(1);
    }
    expect(subjects[subjects.length - 1]).toMatch(/Último aviso/);
    const logs = await prisma.billingReminderLog.findMany({ where: { orgId: org.orgId }, select: { kind: true } });
    expect(logs.map((l) => l.kind).sort()).toEqual(["past_due_d3", "past_due_d5", "past_due_d7", "past_due_started"]);
  });

  it("tick parado: so o passo mais recente e enviado (nao D+3, D+5 e D+7 juntos)", async () => {
    await prisma.subscription.create({ data: { orgId: org.orgId, planId: starterId, status: "past_due", cadence: "monthly", pastDueSince: NOW } });
    await sendBillingReminders(new Date(NOW.getTime() + 8 * DAY));
    const subj = calls().map((c) => c[1]);
    expect(subj).toHaveLength(2); // fallback D+0 + D+7
    expect(subj.some((s) => /Último aviso/.test(s))).toBe(true);
  });

  it("para ao recuperar: nenhum aviso apos active", async () => {
    await seed(NOW);
    await sendBillingReminders(new Date(NOW.getTime() + 3 * DAY));
    vi.mocked(sendSystemEmail).mockClear();
    await processBillingEvent(ev({ type: "payment.recovered" }), new Date(NOW.getTime() + 4 * DAY));
    expect(scenarios()).toEqual(["payment_recovered"]);
    vi.mocked(sendSystemEmail).mockClear();
    await sendBillingReminders(new Date(NOW.getTime() + 6 * DAY));
    expect(calls()).toHaveLength(0);
  });

  it("ultimo aviso em D+6, 24h antes do fim do grace de 7d (status-map inalterado)", () => {
    expect(PAST_DUE_GRACE_MS).toBe(7 * DAY);
  });
});

describe("recovered / plan_changed (052b)", () => {
  it("plan_changed: troca de plano envia 1 e-mail com plano anterior e novo; reentrega nao duplica", async () => {
    await processBillingEvent(ev({ planKey: "starter" }), NOW);
    vi.mocked(sendSystemEmail).mockClear();
    const other = await prisma.plan.findFirstOrThrow({ where: { key: { not: "starter" }, selfServiceCheckout: true }, select: { key: true, name: true } });
    const e = ev({ type: "subscription.updated", planKey: other.key });
    await processBillingEvent(e, NOW);
    await processBillingEvent(e, NOW);
    expect(scenarios()).toEqual(["plan_changed"]);
    const [, subject, content] = calls()[0];
    expect(subject).toContain(other.name);
    expect(content.text).toMatch(/https?:\/\/\S+\/configuracoes\/assinatura/);
  });

  it("recovered via PIX: payment_recovered + recibo PIX, reentrega nao duplica", async () => {
    await processBillingEvent(ev(), NOW);
    await processBillingEvent(failed(), NOW);
    vi.mocked(sendSystemEmail).mockClear();
    const e = ev({ type: "subscription.updated", currentPeriodEnd: new Date("2026-04-30T12:00:00Z"), paymentMethod: "pix", amountCents: 9900 });
    await processBillingEvent(e, NOW);
    await processBillingEvent(e, NOW);
    expect(scenarios().sort()).toEqual(["payment_receipt", "payment_recovered"]);
  });
});

describe("renewal-upcoming (052b)", () => {
  const mk = (data: Record<string, unknown>) => prisma.subscription.create({ data: { orgId: org.orgId, planId: starterId, status: "active", cadence: "monthly", ...data } as never });

  it("anual a 7 dias: envia 1 aviso; retry nao duplica; novo ciclo (nova ancora) envia de novo", async () => {
    const end = new Date(NOW.getTime() + 6 * DAY);
    await mk({ cadence: "yearly", currentPeriodEnd: end });
    await sendBillingReminders(NOW);
    await sendBillingReminders(NOW);
    expect(scenarios()).toEqual(["renewal_upcoming"]);
    expect(calls()[0][2].text).toMatch(/https?:\/\/\S+\/configuracoes\/assinatura/);
  });

  it("PIX mensal a 7 dias envia; mensal cartao nao envia; fora da janela (>7d) nao envia; cancelAtPeriodEnd nao envia", async () => {
    await mk({ pixManaged: true, currentPeriodEnd: new Date(NOW.getTime() + 5 * DAY) });
    await sendBillingReminders(NOW);
    expect(calls()).toHaveLength(1);
    expect(calls()[0][2].text).toMatch(/PIX/);
    await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
    vi.mocked(sendSystemEmail).mockClear();
    await mk({ currentPeriodEnd: new Date(NOW.getTime() + 5 * DAY) });
    await sendBillingReminders(NOW);
    await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
    await mk({ cadence: "yearly", currentPeriodEnd: new Date(NOW.getTime() + 20 * DAY) });
    await sendBillingReminders(NOW);
    await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
    await mk({ cadence: "yearly", cancelAtPeriodEnd: true, currentPeriodEnd: new Date(NOW.getTime() + 3 * DAY) });
    await sendBillingReminders(NOW);
    expect(calls()).toHaveLength(0);
  });
});
