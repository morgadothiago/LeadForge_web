import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { CANCEL_RETENTION_MS, PAST_DUE_GRACE_MS } from "./status-map";
import { sendBillingReminders } from "./reminders";

vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "" })) }));

let org: TestOrg;
let planId: string;

beforeAll(async () => {
  org = await createTestOrg("billing-reminders");
  planId = (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" }, select: { id: true } })).id;
});
afterAll(() => purgeTestOrg(org));
beforeEach(() => vi.mocked(sendSystemEmail).mockClear());
afterEach(async () => {
  await prisma.billingReminderLog.deleteMany({ where: { orgId: org.orgId } });
  await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
  await prisma.organization.update({ where: { id: org.orgId }, data: { status: "active", suspendedReason: null } });
});

const ownerEmail = () => prisma.user.findUniqueOrThrow({ where: { id: org.userId }, select: { email: true } }).then((u) => u.email);

describe("sendBillingReminders (SPEC-039, D-039-2)", () => {
  it("trial_ending: trialEndsAt a <= 3 dias -> envia e-mail ao owner", async () => {
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + 2 * 24 * 3600_000);
    await prisma.subscription.create({ data: { orgId: org.orgId, planId, status: "trialing", cadence: "monthly", trialEndsAt } });

    const r = await sendBillingReminders(now);
    expect(r.sent).toBe(1);
    expect(sendSystemEmail).toHaveBeenCalledTimes(1);
    const [to, subject] = vi.mocked(sendSystemEmail).mock.calls[0];
    expect(to).toBe(await ownerEmail());
    expect(subject).toMatch(/teste/i);
  });

  it("trial_ending: trialEndsAt a > 3 dias -> não envia ainda", async () => {
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + 5 * 24 * 3600_000);
    await prisma.subscription.create({ data: { orgId: org.orgId, planId, status: "trialing", cadence: "monthly", trialEndsAt } });

    const r = await sendBillingReminders(now);
    expect(r.sent).toBe(0);
    expect(sendSystemEmail).not.toHaveBeenCalled();
  });

  it("past_due_started: subscription entra em past_due -> envia aviso de grace period", async () => {
    const now = new Date();
    const pastDueSince = now;
    await prisma.subscription.create({ data: { orgId: org.orgId, planId, status: "past_due", cadence: "monthly", pastDueSince } });

    const r = await sendBillingReminders(now);
    expect(r.sent).toBe(1);
    const [, subject] = vi.mocked(sendSystemEmail).mock.calls[0];
    expect(subject).toMatch(/pagamento/i);
  });

  it("auto_suspended: grace period expirado e Organization já suspensa automaticamente -> envia aviso de suspensão", async () => {
    const now = new Date();
    const pastDueSince = new Date(now.getTime() - (PAST_DUE_GRACE_MS + 1000));
    await prisma.subscription.create({ data: { orgId: org.orgId, planId, status: "past_due", cadence: "monthly", pastDueSince } });
    // simula o que `syncOrgStatuses` (status-map.ts) faz de fato: grava `suspendedReason: "automatic"`
    // no mesmo momento em que suspende, nunca re-derivado depois.
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "suspended", suspendedReason: "automatic" } });

    const r = await sendBillingReminders(now);
    // 1 para past_due_started (mesma ancora, kind diferente) + 1 para auto_suspended.
    expect(r.sent).toBe(2);
    const subjects = vi.mocked(sendSystemEmail).mock.calls.map((c) => c[1]);
    expect(subjects.some((s) => /suspensa/i.test(s))).toBe(true);
  });

  it("auto_suspended: NÃO dispara para suspensão manual (platform_admin) sem past_due", async () => {
    const now = new Date();
    await prisma.subscription.create({ data: { orgId: org.orgId, planId, status: "active", cadence: "monthly" } });
    // simula suspendOrganization manual: `status: "suspended"` + `suspendedReason: "manual"`.
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "suspended", suspendedReason: "manual" } });

    const r = await sendBillingReminders(now);
    expect(r.sent).toBe(0);
    expect(sendSystemEmail).not.toHaveBeenCalled();
  });

  it("auto_suspended: NÃO dispara para suspensão MANUAL mesmo com subscription em past_due e grace JÁ EXPIRADO (achado QA)", async () => {
    // Reproduz exatamente o cenário que o QA apontou como não coberto: subscription já em past_due com
    // grace expirado (o que, isoladamente, levaria `syncOrgStatuses` a suspender automaticamente) MAS a
    // suspensão real foi feita pelo platform_admin (`suspendOrganization`, SPEC-031) — que grava
    // `suspendedReason: "manual"` explicitamente, independente do estado da subscription.
    const now = new Date();
    const pastDueSince = new Date(now.getTime() - (PAST_DUE_GRACE_MS + 1000));
    await prisma.subscription.create({ data: { orgId: org.orgId, planId, status: "past_due", cadence: "monthly", pastDueSince } });
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "suspended", suspendedReason: "manual" } });

    const r = await sendBillingReminders(now);
    // NÃO deve disparar auto_suspended. past_due_started ainda dispara (gatilho 2, independente da causa
    // da suspensão — avisa sobre o past_due em si, não sobre a suspensão) — só auto_suspended é vedado.
    expect(sendSystemEmail).not.toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/suspensa/i), expect.anything());
    const suspendedLog = await prisma.billingReminderLog.findFirst({ where: { orgId: org.orgId, kind: "auto_suspended" } });
    expect(suspendedLog).toBeNull();
    expect(r.errors).toBe(0);
  });

  it("auto_suspended: subscription em past_due DENTRO do grace period + suspensão manual -> não dispara de qualquer forma", async () => {
    // Cobertura extra pedida pelo QA: nem o "não expirou o grace" nem o "foi manual" isoladamente já
    // bastariam para não disparar — aqui os dois motivos coincidem.
    const now = new Date();
    const pastDueSince = new Date(now.getTime() - (PAST_DUE_GRACE_MS - 1000)); // grace ainda não expirou.
    await prisma.subscription.create({ data: { orgId: org.orgId, planId, status: "past_due", cadence: "monthly", pastDueSince } });
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "suspended", suspendedReason: "manual" } });

    const r = await sendBillingReminders(now);
    expect(sendSystemEmail).not.toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/suspensa/i), expect.anything());
    const suspendedLog = await prisma.billingReminderLog.findFirst({ where: { orgId: org.orgId, kind: "auto_suspended" } });
    expect(suspendedLog).toBeNull();
    expect(r.errors).toBe(0);
  });

  it("purge_warning: 75 dias após canceledAt (15 antes do expurgo aos 90) -> envia aviso", async () => {
    const now = new Date();
    const canceledAt = new Date(now.getTime() - (CANCEL_RETENTION_MS - 15 * 24 * 3600_000));
    await prisma.subscription.create({ data: { orgId: org.orgId, planId, status: "canceled", cadence: "monthly", canceledAt } });

    const r = await sendBillingReminders(now);
    expect(r.sent).toBe(1);
    const [, subject] = vi.mocked(sendSystemEmail).mock.calls[0];
    expect(subject).toMatch(/anonimizad/i);
  });

  it("purge_warning: ainda < 75 dias -> não envia", async () => {
    const now = new Date();
    const canceledAt = new Date(now.getTime() - (CANCEL_RETENTION_MS - 20 * 24 * 3600_000));
    await prisma.subscription.create({ data: { orgId: org.orgId, planId, status: "canceled", cadence: "monthly", canceledAt } });

    const r = await sendBillingReminders(now);
    expect(r.sent).toBe(0);
  });

  it("purge_warning: org já expurgada -> não envia (não faz sentido avisar após o fato)", async () => {
    const now = new Date();
    const canceledAt = new Date(now.getTime() - (CANCEL_RETENTION_MS - 15 * 24 * 3600_000));
    await prisma.subscription.create({ data: { orgId: org.orgId, planId, status: "canceled", cadence: "monthly", canceledAt } });
    await prisma.organization.update({ where: { id: org.orgId }, data: { purgedAt: now } });
    try {
      const r = await sendBillingReminders(now);
      expect(r.sent).toBe(0);
      expect(sendSystemEmail).not.toHaveBeenCalled();
    } finally {
      await prisma.organization.update({ where: { id: org.orgId }, data: { purgedAt: null } });
    }
  });

  it("idempotência: rodar o tick de novo no mesmo dia NÃO reenvia o mesmo aviso", async () => {
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + 1 * 24 * 3600_000);
    await prisma.subscription.create({ data: { orgId: org.orgId, planId, status: "trialing", cadence: "monthly", trialEndsAt } });

    const first = await sendBillingReminders(now);
    expect(first.sent).toBe(1);
    // "cron rodou de novo" pouco depois, mesma ancora (trialEndsAt não mudou).
    const second = await sendBillingReminders(new Date(now.getTime() + 3600_000));
    expect(second.sent).toBe(0);
    expect(sendSystemEmail).toHaveBeenCalledTimes(1);
    const count = await prisma.billingReminderLog.count({ where: { orgId: org.orgId, kind: "trial_ending" } });
    expect(count).toBe(1);
  });

  it("novo episódio de past_due (após voltar a ficar em dia) gera um NOVO aviso (ancora diferente)", async () => {
    const now = new Date();
    const firstPastDueSince = now;
    await prisma.subscription.create({ data: { orgId: org.orgId, planId, status: "past_due", cadence: "monthly", pastDueSince: firstPastDueSince } });
    const first = await sendBillingReminders(now);
    expect(first.sent).toBe(1);

    // volta a ficar em dia, depois cai em past_due de novo (nova ancora).
    await prisma.subscription.update({ where: { orgId: org.orgId }, data: { status: "active", pastDueSince: null } });
    const secondPastDueSince = new Date(now.getTime() + 10 * 24 * 3600_000);
    await prisma.subscription.update({ where: { orgId: org.orgId }, data: { status: "past_due", pastDueSince: secondPastDueSince } });
    const second = await sendBillingReminders(secondPastDueSince);
    expect(second.sent).toBe(1);
    expect(sendSystemEmail).toHaveBeenCalledTimes(2);
  });

  it("falha no envio de e-mail (SMTP indisponível) NÃO lança e NÃO derruba o job", async () => {
    vi.mocked(sendSystemEmail).mockResolvedValueOnce({ ok: false, error: new Error("smtp down") as never });
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + 1 * 24 * 3600_000);
    await prisma.subscription.create({ data: { orgId: org.orgId, planId, status: "trialing", cadence: "monthly", trialEndsAt } });

    const r = await sendBillingReminders(now); // não deve lançar mesmo com falha do SMTP.
    expect(r.sent).toBe(1); // "enviado" aqui = tentativa best-effort feita; a falha do transporte só é logada.
    const count = await prisma.billingReminderLog.count({ where: { orgId: org.orgId, kind: "trial_ending" } });
    expect(count).toBe(1); // reserva feita mesmo com falha do SMTP (idempotência prevalece sobre reenvio).
  });

  it("nunca toca dado de outra org (sem vazamento cross-tenant)", async () => {
    const other = await createTestOrg("billing-reminders-other");
    try {
      const now = new Date();
      const trialEndsAt = new Date(now.getTime() + 1 * 24 * 3600_000);
      await prisma.subscription.create({ data: { orgId: other.orgId, planId, status: "trialing", cadence: "monthly", trialEndsAt } });

      const r = await sendBillingReminders(now);
      expect(r.sent).toBe(1);
      const [to] = vi.mocked(sendSystemEmail).mock.calls[0];
      expect(to).not.toBe(await ownerEmail());
      const orgLog = await prisma.billingReminderLog.findMany({ where: { orgId: org.orgId } });
      expect(orgLog).toHaveLength(0);
    } finally {
      await purgeTestOrg(other);
    }
  });
});
