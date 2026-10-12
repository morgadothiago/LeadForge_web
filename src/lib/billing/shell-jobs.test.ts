import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "m1" })) }));

import { prisma } from "@/lib/prisma";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { purgeAbandonedShells, sendOrgSetupReminders } from "./shell-jobs";
import { NOT_SHELL, SHELL_ABANDON_MS } from "./shell";
import { runTick } from "@/lib/scheduler/run-tick";
import { parkOtherOrgs } from "@/lib/test-utils/park-other-orgs";

// SPEC-062 (D-062-18/19): limpeza de cascas nao pagas e lembretes de pago-sem-org.
const DAY = 24 * 3600_000;
const NOW = new Date();
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const users: string[] = [];
const orgs: string[] = [];

async function mkShell(opts: {
  ageDays: number;
  sub?: "none" | "incomplete" | "active" | "past_due" | "canceled";
  externalSubscriptionId?: string;
  webhook?: boolean;
  webhookAgeDays?: number;
  members?: number;
  canceledAgeDays?: number;
  shell?: boolean;
}): Promise<{ orgId: string; userId: string | null }> {
  const orgId = randomUUID();
  await prisma.organization.create({
    data: { id: orgId, name: "zz shell", slug: `pendente-${orgId.slice(0, 8)}`, status: "suspended", setupPendingSince: opts.shell === false ? null : ago(opts.ageDays * DAY) },
  });
  orgs.push(orgId);
  let userId: string | null = null;
  for (let i = 0; i < (opts.members ?? 1); i++) {
    const id = randomUUID();
    await prisma.user.create({ data: { id, name: "zz", email: `zz-shell-${id.slice(0, 8)}@test.local`, role: "provider" } });
    users.push(id);
    userId ??= id;
    await prisma.membership.create({ data: { userId: id, orgId, orgRole: i === 0 ? "owner" : "member" } });
  }
  if (opts.sub && opts.sub !== "none") {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } });
    await prisma.subscription.create({
      data: {
        orgId, planId: plan.id, status: opts.sub, externalSubscriptionId: opts.externalSubscriptionId ?? null,
        canceledAt: opts.sub === "canceled" ? ago((opts.canceledAgeDays ?? 0) * DAY) : null,
      },
    });
  }
  if (opts.webhook) {
    await prisma.webhookEvent.create({ data: { orgId, source: "billing", eventId: `zz-wh-${randomUUID()}`, payload: {}, createdAt: ago((opts.webhookAgeDays ?? opts.ageDays) * DAY) } });
  }
  return { orgId, userId };
}
const exists = async (orgId: string) => (await prisma.organization.count({ where: { id: orgId } })) === 1;

beforeEach(() => vi.mocked(sendSystemEmail).mockClear());
afterAll(async () => {
  await prisma.emailDispatchLog.deleteMany({ where: { OR: [{ orgId: { in: orgs } }, { userId: { in: users } }] } });
  await prisma.webhookEvent.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.membership.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.subscription.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

describe("purgeAbandonedShells (D-062-18/20)", () => {
  it("apaga casca incomplete / sem assinatura / sem membros com > 7 dias e sem pagamento; cascade de Membership e Subscription", async () => {
    const a = await mkShell({ ageDays: 8, sub: "incomplete" });
    const b = await mkShell({ ageDays: 9, sub: "none" });
    const c = await mkShell({ ageDays: 10, sub: "incomplete", members: 0 });
    const r = await purgeAbandonedShells(NOW);
    expect(r.purged).toBeGreaterThanOrEqual(3);
    expect(r.errors).toBe(0);
    for (const s of [a, b, c]) expect(await exists(s.orgId)).toBe(false);
    expect(await prisma.membership.count({ where: { orgId: { in: [a.orgId, b.orgId, c.orgId] } } })).toBe(0);
    expect(await prisma.subscription.count({ where: { orgId: { in: [a.orgId, b.orgId, c.orgId] } } })).toBe(0);
    // o usuario NAO e apagado, so a casca
    expect(await prisma.user.count({ where: { id: a.userId! } })).toBe(1);
  });

  it("NAO apaga casca recente (<= 7 dias) mesmo sem pagamento", async () => {
    const s = await mkShell({ ageDays: 6, sub: "incomplete" });
    const edge = await mkShell({ ageDays: 7 - 1 / 24, sub: "incomplete" });
    await purgeAbandonedShells(NOW);
    expect(await exists(s.orgId)).toBe(true);
    expect(await exists(edge.orgId)).toBe(true);
  });

  it("NUNCA apaga casca com qualquer sinal de pagamento (active, past_due, externalSubscriptionId, WebhookEvent), por mais antiga que seja", async () => {
    const active = await mkShell({ ageDays: 60, sub: "active" });
    const pastDue = await mkShell({ ageDays: 60, sub: "past_due" });
    const ext = await mkShell({ ageDays: 60, sub: "incomplete", externalSubscriptionId: "sub_ext" });
    const wh = await mkShell({ ageDays: 60, sub: "incomplete", webhook: true });
    const whNoSub = await mkShell({ ageDays: 60, sub: "none", webhook: true });
    const paidNoMembers = await mkShell({ ageDays: 60, sub: "active", members: 0 });
    await purgeAbandonedShells(NOW);
    for (const s of [active, pastDue, ext, wh, whNoSub, paidNoMembers]) expect(await exists(s.orgId), s.orgId).toBe(true);
  });

  it("casca cancelada e efetivada ha > 7 dias e apagada (D-062-20); cancelada recentemente, nao", async () => {
    const old = await mkShell({ ageDays: 30, sub: "canceled", canceledAgeDays: 8, webhook: true, externalSubscriptionId: "sub_x" });
    const recent = await mkShell({ ageDays: 30, sub: "canceled", canceledAgeDays: 2, webhook: true, externalSubscriptionId: "sub_y" });
    await purgeAbandonedShells(NOW);
    expect(await exists(old.orgId)).toBe(false);
    expect(await exists(recent.orgId)).toBe(true);
  });

  it("NUNCA apaga organizacao real (setupPendingSince nulo), mesmo velha e sem assinatura", async () => {
    const real = await mkShell({ ageDays: 365, sub: "none", shell: false });
    await purgeAbandonedShells(NOW);
    expect(await exists(real.orgId)).toBe(true);
  });

  it("idempotente (2a rodada nao apaga mais nada) e falha isolada nao derruba o job", async () => {
    const s = await mkShell({ ageDays: 20, sub: "incomplete" });
    await purgeAbandonedShells(NOW);
    expect(await exists(s.orgId)).toBe(false);
    const again = await purgeAbandonedShells(NOW);
    expect(again.errors).toBe(0);
    // erro em uma casca nao impede as outras: simula falha no delete da primeira
    const x = await mkShell({ ageDays: 20, sub: "incomplete" });
    const y = await mkShell({ ageDays: 20, sub: "incomplete" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let first = true;
    const deleteSpy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(async () => {
      first = false;
      throw new Error("boom");
    });
    try {
      const r = await purgeAbandonedShells(NOW);
      expect(first).toBe(false);
      expect(r.errors).toBe(1);
    } finally {
      deleteSpy.mockRestore();
      spy.mockRestore();
    }
    await purgeAbandonedShells(NOW);
    expect([await exists(x.orgId), await exists(y.orgId)]).toEqual([false, false]);
  });

  it("janela configurada em 7 dias", () => {
    expect(SHELL_ABANDON_MS).toBe(7 * DAY);
  });
});

describe("sendOrgSetupReminders (D-062-19)", () => {
  const sentTo = () => vi.mocked(sendSystemEmail).mock.calls.map((c) => ({ to: c[0], scenario: c[3] }));
  const keys = async (orgId: string) => (await prisma.emailDispatchLog.findMany({ where: { orgId, scenario: "org_setup_reminder" }, select: { dedupeKey: true } })).map((k) => k.dedupeKey);

  it("casca PAGA sem org: D+1, D+3 e D+7 saem 1x cada (noreply/scenario org_setup_reminder), reexecucao nao duplica", async () => {
    const s = await mkShell({ ageDays: 0, sub: "active" });
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: s.userId! }, select: { email: true } });
    const run = (days: number) => sendOrgSetupReminders(new Date(NOW.getTime() + days * DAY));
    await run(0.5);
    expect(await keys(s.orgId)).toHaveLength(0);
    await run(1.1);
    await run(1.2); // mesma janela: sem duplicar
    expect(await keys(s.orgId)).toEqual([`org_setup_reminder:${s.orgId}:d1:${s.userId}`]);
    await run(3.1);
    await run(5);
    await run(7.1);
    await run(7.5);
    const k = (await keys(s.orgId)).sort();
    expect(k).toEqual([`org_setup_reminder:${s.orgId}:d1:${s.userId}`, `org_setup_reminder:${s.orgId}:d3:${s.userId}`, `org_setup_reminder:${s.orgId}:d7:${s.userId}`].sort());
    expect(sentTo().filter((m) => m.scenario === "org_setup_reminder" && m.to === owner.email)).toHaveLength(3);
    // so ate D+7: depois da janela nao sai mais nada
    vi.mocked(sendSystemEmail).mockClear();
    await run(20);
    expect(sentTo()).toHaveLength(0);
  });

  it("tick parado: so o passo mais recente devido e enviado (nao 3 e-mails juntos)", async () => {
    const s = await mkShell({ ageDays: 0, sub: "active" });
    await sendOrgSetupReminders(new Date(NOW.getTime() + 4 * DAY));
    expect(await keys(s.orgId)).toEqual([`org_setup_reminder:${s.orgId}:d3:${s.userId}`]);
  });

  it("ancora = primeiro evento de billing (quando pagou), nao a criacao da casca", async () => {
    const s = await mkShell({ ageDays: 6, sub: "active", webhook: true, webhookAgeDays: 0 });
    await sendOrgSetupReminders(NOW); // casca tem 6 dias, mas pagou agora: nada
    expect(await keys(s.orgId)).toHaveLength(0);
  });

  it("para ao finalizar a org (setupPendingSince nulo) e nunca envia para casca nao paga ou organizacao real", async () => {
    const done = await mkShell({ ageDays: 2, sub: "active" });
    await prisma.organization.update({ where: { id: done.orgId }, data: { setupPendingSince: null } });
    const unpaid = await mkShell({ ageDays: 2, sub: "incomplete" });
    const real = await mkShell({ ageDays: 2, sub: "active", shell: false });
    await sendOrgSetupReminders(NOW);
    for (const s of [done, unpaid, real]) expect(await keys(s.orgId)).toHaveLength(0);
  });
});

describe("tick do scheduler ignora a casca (risco D-062-5)", () => {
  it("casca paga fica status=active mas NAO entra na rodada do scheduler (sem SchedulerRun); org real ativa entra", async () => {
    const shell = await mkShell({ ageDays: 1, sub: "active" });
    await prisma.organization.update({ where: { id: shell.orgId }, data: { status: "active" } });
    const real = await mkShell({ ageDays: 1, sub: "active", shell: false });
    await prisma.organization.update({ where: { id: real.orgId }, data: { status: "active" } });
    const parked = await parkOtherOrgs(shell.orgId, real.orgId);
    try {
      await runTick(new Date(), { acquireLock: async () => ({ release: async () => {} }) as never });
      expect(await prisma.schedulerRun.count({ where: { orgId: shell.orgId } })).toBe(0);
      expect(await prisma.schedulerRun.count({ where: { orgId: real.orgId } })).toBeGreaterThanOrEqual(1);
    } finally {
      await parked.restore();
      await prisma.schedulerRun.deleteMany({ where: { orgId: { in: [shell.orgId, real.orgId] } } });
    }
  });

  it("NOT_SHELL filtra so organizacoes reais", async () => {
    const shell = await mkShell({ ageDays: 1, sub: "active" });
    const real = await mkShell({ ageDays: 1, sub: "active", shell: false });
    const found = await prisma.organization.findMany({ where: { id: { in: [shell.orgId, real.orgId] }, ...NOT_SHELL }, select: { id: true } });
    expect(found.map((o) => o.id)).toEqual([real.orgId]);
  });
});
