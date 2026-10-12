import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { FakeWhatsAppProvider } from "@/lib/whatsapp/providers/fake";
import { TIMEOUT_WARNING } from "@/lib/channels/whatsapp";
import { dropInboxOrg, mkConversation, mkInboxOrg, mkLeadIn, type InboxOrg } from "@/lib/test-utils/inbox-fixture";
import { ensureTestPlan, setOrgPlan, setTrial } from "@/lib/test-utils/trial-fixture";
import { sendManualWhatsApp, type SendManualResult } from "./send-manual";
import { monthKey } from "@/lib/billing/usage";

/** SPEC-068a: guardas da resposta manual (D-068-3/4/5), com relógio injetado e provider fake. */
let A: InboxOrg;
let B: InboxOrg;
const HOUR = 3600_000;
const NOW = new Date(); // regras relativas a NOW (trial usa o relógio real nos fixtures)

async function setup(org: InboxOrg = A, opts: { lastInboundAt?: Date | null; leadOver?: Record<string, unknown> } = {}) {
  const lead = await mkLeadIn(org, opts.leadOver);
  const conv = await mkConversation(org, { leadId: lead.id, phone: lead.phone!, lastInboundAt: opts.lastInboundAt === undefined ? new Date(NOW.getTime() - HOUR) : opts.lastInboundAt, unreadCount: 3 });
  return { lead, conv };
}
const send = (conversationId: string, text = "Olá, tudo bem?", over: { org?: InboxOrg; userId?: string; clientMessageId?: string; now?: Date; provider?: FakeWhatsAppProvider } = {}): Promise<SendManualResult> => {
  const org = over.org ?? A;
  return sendManualWhatsApp({ orgId: org.orgId, userId: over.userId ?? org.userId, conversationId, clientMessageId: over.clientMessageId ?? randomUUID(), text }, { now: over.now ?? NOW, provider: over.provider ?? new UniqueFake() });
};
/** Ids únicos entre instâncias do fake (o provider real devolve ids únicos; o fake reinicia em 1). */
let uniq = 0;
class UniqueFake extends FakeWhatsAppProvider {
  override async sendText(i: Parameters<FakeWhatsAppProvider["sendText"]>[0]) {
    const r = await super.sendText(i);
    return { externalId: `${r.externalId}-${++uniq}` };
  }
}
const code = (r: SendManualResult) => (r.ok ? "ok" : r.code);

beforeAll(async () => {
  A = await mkInboxOrg("sma");
  B = await mkInboxOrg("smb");
}, 30000);
afterAll(async () => {
  await dropInboxOrg(A);
  await dropInboxOrg(B);
});
beforeEach(async () => {
  vi.restoreAllMocks();
  for (const o of [A, B]) {
    await prisma.agentRun.deleteMany({ where: { lead: { campaign: { orgId: o.orgId } } } });
    await prisma.waMessage.deleteMany({ where: { orgId: o.orgId } });
    await prisma.waConversation.deleteMany({ where: { orgId: o.orgId } });
    await prisma.touch.deleteMany({ where: { lead: { campaign: { orgId: o.orgId } } } });
    await prisma.suppression.deleteMany({ where: { orgId: o.orgId } });
    await prisma.subscription.deleteMany({ where: { orgId: o.orgId } });
    await prisma.usageCounter.deleteMany({ where: { orgId: o.orgId } });
    await prisma.organization.update({ where: { id: o.orgId }, data: { status: "active" } });
    await prisma.user.updateMany({ where: { id: { in: [o.userId, o.memberUserId] } }, data: { emailVerifiedAt: new Date() } });
    await prisma.whatsAppInstance.update({ where: { id: o.instanceId }, data: { status: "connected", health: "good", pausedUntil: null, dailyLimit: 30, warmupStartedAt: new Date("2026-01-01T00:00:00Z") } });
  }
});

describe("envio feliz e efeitos", () => {
  it("envia, grava sent + externalId, zera não lidas, marca atendendo, humano assumiu e cancela AgentRun pendente", async () => {
    const { lead, conv } = await setup();
    const agent = await prisma.agent.create({ data: { orgId: A.orgId, role: "closer", name: "zz closer" } });
    await prisma.agentRun.create({ data: { agentId: agent.id, leadId: lead.id, trigger: "inbound:x", status: "queued" } });
    const draftRun = await prisma.agentRun.create({ data: { agentId: agent.id, leadId: lead.id, trigger: "inbound:y", status: "completed" } });
    await prisma.draft.create({ data: { agentRunId: draftRun.id, leadId: lead.id, channel: "whatsapp", body: "rascunho", status: "pending" } });
    const fake = new UniqueFake();
    const r = await send(conv.id, "  Claro, posso ajudar!  ", { provider: fake });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.duplicate).toBe(false);
    expect(r.message).toMatchObject({ direction: "outbound", origin: "manual", status: "sent", body: "Claro, posso ajudar!" });
    expect(fake.sent).toEqual([{ instanceName: A.instanceName, to: lead.phone, text: "Claro, posso ajudar!" }]);
    const row = await prisma.waMessage.findUniqueOrThrow({ where: { id: r.message.id } });
    expect(row).toMatchObject({ externalId: expect.stringMatching(/^fake-msg-1-\d+$/), sentByUserId: A.userId, orgId: A.orgId, status: "sent" });
    expect(await prisma.waConversation.findUniqueOrThrow({ where: { id: conv.id } })).toMatchObject({ status: "attending", unreadCount: 0, lastMessagePreview: "Claro, posso ajudar!", lastMessageDirection: "outbound" });
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(l.handoffAt).not.toBeNull();
    expect(l.sequenceStatus).toBe("paused_manual");
    expect((await prisma.agentRun.findMany({ where: { leadId: lead.id } })).map((x) => x.status).sort()).toEqual(["completed", "skipped"]);
    expect((await prisma.draft.findFirstOrThrow({ where: { leadId: lead.id } })).status).toBe("expired");
    expect(await prisma.orgAuditLog.findFirstOrThrow({ where: { orgId: A.orgId, action: "inbox_manual_sent" } })).toMatchObject({ actorUserId: A.userId, meta: { conversationId: conv.id, messageId: r.message.id, kind: "text", length: 20 } });
    expect((await prisma.usageCounter.findFirstOrThrow({ where: { orgId: A.orgId, metric: "manual_replies" } })).count).toBe(1);
  });

  it("member também responde", async () => {
    const { conv } = await setup();
    expect(code(await send(conv.id, "oi", { userId: A.memberUserId }))).toBe("ok");
  });

  it("não loga texto nem telefone", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { lead, conv } = await setup();
    const fake = new UniqueFake();
    fake.sendError = new AppError({ code: "upstream", status: 500, userMessage: "falhou" });
    await send(conv.id, "SEGREDO-NO-TEXTO-123", { provider: fake });
    const all = spies.flatMap((s) => s.mock.calls.flat()).join(" ");
    expect(all).not.toContain("SEGREDO-NO-TEXTO-123");
    expect(all).not.toContain(lead.phone!);
    expect(all).not.toContain(lead.phone!.replace("+", ""));
  });
});

describe("janela de conversa de 24h (D-068-4)", () => {
  it("23h59 libera, 24h00 libera, 24h01 bloqueia (conversation_window_closed)", async () => {
    const mk = async (ms: number) => (await setup(A, { lastInboundAt: new Date(NOW.getTime() - ms) })).conv.id;
    expect(code(await send(await mk(24 * HOUR - 60_000)))).toBe("ok");
    const c2 = await mk(24 * HOUR);
    await prisma.waMessage.deleteMany({ where: { orgId: A.orgId } }); // zera o espaçamento entre envios
    expect(code(await send(c2))).toBe("ok");
    await prisma.waMessage.deleteMany({ where: { orgId: A.orgId } });
    const fake = new UniqueFake();
    const r = await send(await mk(24 * HOUR + 60_000), "oi", { provider: fake });
    expect(code(r)).toBe("conversation_window_closed");
    expect(fake.sent).toHaveLength(0);
  });

  it("sem mensagem do lead (só automáticas) = primeiro contato manual bloqueado", async () => {
    const { conv } = await setup(A, { lastInboundAt: null });
    expect(code(await send(conv.id))).toBe("conversation_window_closed");
  });

  it("fim de semana, madrugada e feriado NÃO bloqueiam (não vale a janela 9-12/14-17 da 017)", async () => {
    for (const iso of ["2026-06-13T06:00:00Z" /* sáb 03:00 SP */, "2026-12-25T15:00:00Z" /* Natal */, "2026-06-14T01:30:00Z" /* sáb 22:30 SP */]) {
      await prisma.waMessage.deleteMany({ where: { orgId: A.orgId } });
      const now = new Date(iso);
      const lead = await mkLeadIn(A);
      const conv = await mkConversation(A, { leadId: lead.id, phone: lead.phone!, lastInboundAt: new Date(now.getTime() - HOUR) });
      expect(code(await send(conv.id, "oi", { now }))).toBe("ok");
    }
  });
});

describe("opt-out, supressão e instância", () => {
  it("optedOutAt, sequenceStatus=opted_out e supressão bloqueiam sem override; possibleOptOut NÃO bloqueia", async () => {
    const fake = new UniqueFake();
    expect(code(await send((await setup(A, { leadOver: { optedOutAt: new Date() } })).conv.id, "oi", { provider: fake }))).toBe("opted_out");
    expect(code(await send((await setup(A, { leadOver: { sequenceStatus: "opted_out" } })).conv.id, "oi", { provider: fake }))).toBe("opted_out");
    const s = await setup(A);
    await prisma.suppression.create({ data: { orgId: A.orgId, kind: "phone", value: s.lead.phone!, reason: "manual" } });
    expect(code(await send(s.conv.id, "oi", { provider: fake }))).toBe("opted_out");
    expect(fake.sent).toHaveLength(0);
    expect(code(await send((await setup(A, { leadOver: { possibleOptOut: true } })).conv.id, "oi", { provider: fake }))).toBe("ok");
  });

  it("instância desconectada ou pausada por saúde -> instance_unavailable", async () => {
    const { conv } = await setup();
    await prisma.whatsAppInstance.update({ where: { id: A.instanceId }, data: { status: "disconnected" } });
    expect(code(await send(conv.id))).toBe("instance_unavailable");
    await prisma.whatsAppInstance.update({ where: { id: A.instanceId }, data: { status: "connected", health: "paused", pausedUntil: new Date(NOW.getTime() + HOUR) } });
    expect(code(await send(conv.id))).toBe("instance_unavailable");
  });
});

describe("limites anti-ban (D-068-5)", () => {
  it("espaçamento de 3 s: o segundo envio é rate_limited com retryAfterSeconds; 3 s depois libera", async () => {
    const a = await setup();
    const b = await setup();
    expect(code(await send(a.conv.id, "um"))).toBe("ok");
    const r = await send(b.conv.id, "dois", { now: new Date(NOW.getTime() + 1000) });
    expect(r).toMatchObject({ ok: false, code: "rate_limited", retryAfterSeconds: 2 });
    expect(code(await send(b.conv.id, "dois", { now: new Date(NOW.getTime() + 3000) }))).toBe("ok");
  });

  it("espaçamento também conta o envio automático (Touch) recente", async () => {
    const { lead, conv } = await setup();
    await prisma.touch.create({ data: { leadId: lead.id, channel: "whatsapp", status: "sent", sentAt: new Date(NOW.getTime() - 1000), whatsappInstanceId: A.instanceId } });
    expect(await send(conv.id)).toMatchObject({ ok: false, code: "rate_limited", retryAfterSeconds: 2 });
  });

  it("teto de 20 manuais por minuto por instância", async () => {
    const { conv } = await setup();
    const rows = Array.from({ length: 20 }, (_, i) => ({
      orgId: A.orgId, conversationId: conv.id, whatsappInstanceId: A.instanceId, direction: "outbound" as const, origin: "manual" as const, body: "x", status: "sent" as const,
      messageAt: new Date(NOW.getTime() - 58_000 + i * 2000), // 20 envios nos últimos 58 s, o último há 20 s
    }));
    await prisma.waMessage.createMany({ data: rows });
    const r = await send(conv.id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("rate_limited");
    expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(r.retryAfterSeconds).toBe(2);
    // passado 1 minuto do mais antigo, libera
    expect(code(await send(conv.id, "oi", { now: new Date(NOW.getTime() + 61_000) }))).toBe("ok");
  });

  it("teto diário da instância soma automáticos + manuais e vira rate_limited até o próximo dia", async () => {
    await prisma.whatsAppInstance.update({ where: { id: A.instanceId }, data: { dailyLimit: 2 } });
    const { lead, conv } = await setup();
    await prisma.touch.create({ data: { leadId: lead.id, channel: "whatsapp", status: "sent", sentAt: new Date(NOW.getTime() - 5 * HOUR), whatsappInstanceId: A.instanceId } });
    expect(code(await send(conv.id, "um", { now: new Date(NOW.getTime() + 10_000) }))).toBe("ok");
    const r = await send(conv.id, "dois", { now: new Date(NOW.getTime() + 20_000) });
    expect(r).toMatchObject({ ok: false, code: "rate_limited" });
    if (!r.ok) expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("erro 429 do provider vira failed COM retryAfterSeconds; sem Retry-After vem sem o campo", async () => {
    const a = await setup();
    const f1 = new UniqueFake();
    f1.sendError = new AppError({ code: "rate_limited", status: 429, userMessage: "Muitas requisições.", retryAfterSeconds: 42 });
    expect(await send(a.conv.id, "oi", { provider: f1 })).toMatchObject({ ok: false, code: "send_failed", retryAfterSeconds: 42, message: { status: "failed" } });
    const b = await setup();
    const f2 = new UniqueFake();
    f2.sendError = new AppError({ code: "rate_limited", status: 429, userMessage: "Muitas requisições." });
    const r2 = await send(b.conv.id, "oi", { provider: f2, now: new Date(NOW.getTime() + 5000) });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.retryAfterSeconds).toBeUndefined();
  });
});

describe("org, plano e e-mail", () => {
  it("trial expirado -> trial_expired; org suspensa -> org_suspended; e-mail não verificado -> email_not_verified", async () => {
    const { conv } = await setup();
    await ensureTestPlan("zz-inbox-plan", { maxSendsPerDay: 1 });
    await setTrial(A.orgId, "zz-inbox-plan", true);
    expect(code(await send(conv.id))).toBe("trial_expired");
    await prisma.subscription.deleteMany({ where: { orgId: A.orgId } });
    await prisma.organization.update({ where: { id: A.orgId }, data: { status: "suspended" } });
    expect(code(await send(conv.id))).toBe("org_suspended");
    await prisma.organization.update({ where: { id: A.orgId }, data: { status: "active" } });
    await prisma.user.update({ where: { id: A.userId }, data: { emailVerifiedAt: null } });
    expect(code(await send(conv.id))).toBe("email_not_verified");
  });

  it("plan_limit de `sends` NÃO bloqueia a resposta (Q-068-2); só conta manual_replies", async () => {
    const { conv } = await setup();
    await ensureTestPlan("zz-inbox-plan", { maxSendsPerDay: 1 });
    await setOrgPlan(A.orgId, { planKey: "zz-inbox-plan", status: "active", currentPeriodEnd: new Date(Date.now() + 20 * 86400_000), trialEndsAt: null });
    await prisma.usageCounter.create({ data: { orgId: A.orgId, metric: "sends", periodKey: "x", count: 99 } });
    expect(code(await send(conv.id))).toBe("ok");
    expect((await prisma.usageCounter.findFirstOrThrow({ where: { orgId: A.orgId, metric: "manual_replies" } })).periodKey).toBe(monthKey(NOW));
  });
});

describe("idempotência e falhas", () => {
  it("duplo clique simultâneo com o mesmo clientMessageId envia UMA vez", async () => {
    const { conv } = await setup();
    const fake = new UniqueFake();
    const clientMessageId = randomUUID();
    const [r1, r2] = await Promise.all([send(conv.id, "oi", { provider: fake, clientMessageId }), send(conv.id, "oi", { provider: fake, clientMessageId })]);
    expect(fake.sent).toHaveLength(1);
    expect([r1, r2].every((r) => r.ok)).toBe(true);
    expect([r1, r2].filter((r) => r.ok && r.duplicate)).toHaveLength(1);
    expect(await prisma.waMessage.count({ where: { orgId: A.orgId } })).toBe(1);
  });

  it("reenvio do mesmo clientMessageId devolve a existente (mesmo após a janela fechar)", async () => {
    const { conv } = await setup();
    const clientMessageId = randomUUID();
    const first = await send(conv.id, "oi", { clientMessageId });
    const again = await send(conv.id, "oi", { clientMessageId, now: new Date(NOW.getTime() + 48 * HOUR) });
    expect(again.ok && again.duplicate && first.ok && again.message.id === first.message.id).toBe(true);
  });

  it("timeout -> failed + aviso 'verifique no WhatsApp', sem reenvio automático; reenvio é novo clientMessageId", async () => {
    const { conv } = await setup();
    const fake = new UniqueFake();
    fake.sendError = new AppError({ code: "timeout", userMessage: "Tempo esgotado." });
    const spy = vi.spyOn(fake, "sendText");
    const r = await send(conv.id, "oi", { provider: fake });
    expect(r).toMatchObject({ ok: false, code: "send_failed", error: TIMEOUT_WARNING, message: { status: "failed", error: TIMEOUT_WARNING } });
    expect(spy).toHaveBeenCalledTimes(1);
    const row = await prisma.waMessage.findFirstOrThrow({ where: { orgId: A.orgId } });
    expect(row).toMatchObject({ status: "failed", externalId: null });
  });

  it("validação do texto: vazio, só espaços, > 4096, caracteres de controle", async () => {
    const { conv } = await setup();
    expect(code(await send(conv.id, "   "))).toBe("validation");
    expect(code(await send(conv.id, "a".repeat(4097)))).toBe("message_too_long");
    expect(code(await send(conv.id, "oi\u0000"))).toBe("validation");
    expect(code(await send(conv.id, "a".repeat(4096), { now: new Date(NOW.getTime() + 5000) }))).toBe("ok");
  });
});

describe("isolamento A/B", () => {
  it("usuário da org B não responde conversa da org A (not_found); platform_admin é recusado; orgId de B não alcança instância de A", async () => {
    const { conv } = await setup(A);
    const fake = new UniqueFake();
    expect(code(await send(conv.id, "oi", { org: B, provider: fake }))).toBe("not_found");
    // usuário de B usando orgId de A (sem Membership) -> forbidden
    const r = await sendManualWhatsApp({ orgId: A.orgId, userId: B.userId, conversationId: conv.id, clientMessageId: randomUUID(), text: "oi" }, { now: NOW, provider: fake });
    expect(code(r)).toBe("forbidden");
    const admin = await prisma.user.create({ data: { name: "zz admin", email: `zz-adm-${randomUUID()}@test.local`, role: "platform_admin" } });
    await prisma.membership.create({ data: { userId: admin.id, orgId: A.orgId, orgRole: "member" } });
    expect(code(await send(conv.id, "oi", { userId: admin.id, provider: fake }))).toBe("forbidden");
    await prisma.membership.deleteMany({ where: { userId: admin.id } });
    await prisma.user.delete({ where: { id: admin.id } });
    expect(fake.sent).toHaveLength(0);
    expect(await prisma.waMessage.count({ where: { orgId: { in: [A.orgId, B.orgId] } } })).toBe(0);
  });
});
