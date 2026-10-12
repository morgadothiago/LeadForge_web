import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { FakeWhatsAppProvider } from "@/lib/whatsapp/providers/fake";
const fake = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/whatsapp/provider", async (orig) => ({ ...(await orig<typeof import("@/lib/whatsapp/provider")>()), getWhatsAppProvider: () => fake.current }));

import { prisma } from "@/lib/prisma";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { dropInboxOrg, mkConversation, mkInboxOrg, mkLeadIn, type InboxOrg } from "@/lib/test-utils/inbox-fixture";
import { ensureTestPlan, setOrgPlan, setTrial } from "@/lib/test-utils/trial-fixture";
import { markConversationRead, sendManualMessage, setConversationStatus } from "./inbox";

/** SPEC-068a: Server Actions da caixa (sessão, papéis owner/member, platform_admin sem acesso, isolamento A/B, orgId forjado). */
let A: InboxOrg;
let B: InboxOrg;
const mk = async (org: InboxOrg = A, unread = 2) => {
  const lead = await mkLeadIn(org);
  return mkConversation(org, { leadId: lead.id, phone: lead.phone!, lastInboundAt: new Date(Date.now() - 3600_000), unreadCount: unread });
};
const errs = (r: { ok: boolean; errors?: Record<string, string[]> }) => (r.ok ? null : r.errors);

beforeAll(async () => {
  A = await mkInboxOrg("aca");
  B = await mkInboxOrg("acb");
}, 30000);
afterAll(async () => {
  signOut();
  await dropInboxOrg(A);
  await dropInboxOrg(B);
});
beforeEach(async () => {
  signOut();
  fake.current = new FakeWhatsAppProvider();
  for (const o of [A, B]) {
    await prisma.waMessage.deleteMany({ where: { orgId: o.orgId } });
    await prisma.waConversation.deleteMany({ where: { orgId: o.orgId } });
    await prisma.touch.deleteMany({ where: { lead: { campaign: { orgId: o.orgId } } } });
    await prisma.subscription.deleteMany({ where: { orgId: o.orgId } });
    await prisma.organization.update({ where: { id: o.orgId }, data: { status: "active" } });
  }
});

describe("sendManualMessage", () => {
  it("owner envia; member envia; orgId forjado no corpo é ignorado (usa a org da sessão)", async () => {
    const c = await mk();
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const r = await sendManualMessage({ conversationId: c.id, clientMessageId: randomUUID(), text: "oi", orgId: B.orgId });
    expect(r.ok).toBe(true);
    expect((fake.current as FakeWhatsAppProvider).sent).toHaveLength(1);
    expect(await prisma.waMessage.count({ where: { orgId: B.orgId } })).toBe(0);
    await signInAs(A.memberUserId, { orgId: A.orgId, platformRole: "provider" });
    // espaçamento de 3 s: o segundo envio real dentro de 3 s é rate_limited (com retryAfterSeconds no contrato do ActionResult)
    const r2 = await sendManualMessage({ conversationId: c.id, clientMessageId: randomUUID(), text: "oi 2" });
    expect(errs(r2)?.code).toEqual(["rate_limited"]);
    expect(Number(errs(r2)?.retryAfterSeconds?.[0])).toBeGreaterThanOrEqual(1);
  });

  it("org B não responde conversa da A (erro de conversa não encontrada com code not_found); sem sessão = sessão expirada", async () => {
    const c = await mk(A);
    await signInAs(B.userId, { orgId: B.orgId, platformRole: "provider" });
    const r = await sendManualMessage({ conversationId: c.id, clientMessageId: randomUUID(), text: "oi" });
    expect(errs(r)).toEqual({ _form: ["Conversa não encontrada."], code: ["not_found"] });
    expect((fake.current as FakeWhatsAppProvider).sent).toHaveLength(0);
    signOut();
    expect(errs(await sendManualMessage({ conversationId: c.id, clientMessageId: randomUUID(), text: "oi" }))?._form).toEqual(["Sessão expirada. Faça login novamente."]);
  });

  it("platform_admin é recusado", async () => {
    const c = await mk();
    const admin = await prisma.user.create({ data: { name: "zz adm", email: `zz-adm-${randomUUID()}@test.local`, role: "platform_admin" } });
    await signInAs(admin.id, { orgId: null, platformRole: "platform_admin" });
    expect(errs(await sendManualMessage({ conversationId: c.id, clientMessageId: randomUUID(), text: "oi" }))?._form).toEqual(["Sem permissão."]);
    await prisma.user.delete({ where: { id: admin.id } });
  });

  it("trial expirado e org suspensa bloqueiam na guarda da sessão, com code", async () => {
    const c = await mk();
    await ensureTestPlan("zz-inbox-plan", {});
    await setTrial(A.orgId, "zz-inbox-plan", true);
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    expect(errs(await sendManualMessage({ conversationId: c.id, clientMessageId: randomUUID(), text: "oi" }))?.code).toEqual(["trial_expired"]);
    await setOrgPlan(A.orgId, { planKey: "zz-inbox-plan", status: "active", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 86400_000), orgStatus: "suspended" });
    expect(errs(await sendManualMessage({ conversationId: c.id, clientMessageId: randomUUID(), text: "oi" }))?._form?.[0]).toMatch(/Assinatura pendente/);
  });

  it("entrada inválida (uuid, texto não string) vira erro de validação sem tocar no provider", async () => {
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    expect(errs(await sendManualMessage({ conversationId: "x", clientMessageId: "y", text: "oi" }))).toBeTruthy();
    expect(errs(await sendManualMessage({ conversationId: randomUUID(), clientMessageId: randomUUID(), text: 5 }))).toBeTruthy();
    expect(errs(await sendManualMessage(null))).toBeTruthy();
    expect((fake.current as FakeWhatsAppProvider).sent).toHaveLength(0);
  });
});

describe("markConversationRead / setConversationStatus", () => {
  it("abrir a conversa zera o não lido para todos; idempotente; outra org = não encontrada e nada muda", async () => {
    const c = await mk(A, 5);
    const cb = await mk(B, 7);
    await signInAs(A.memberUserId, { orgId: A.orgId, platformRole: "provider" });
    expect((await markConversationRead({ conversationId: c.id })).ok).toBe(true);
    expect((await markConversationRead({ conversationId: c.id })).ok).toBe(true);
    expect((await prisma.waConversation.findUniqueOrThrow({ where: { id: c.id } })).unreadCount).toBe(0);
    expect(errs(await markConversationRead({ conversationId: cb.id }))?._form).toEqual(["Conversa não encontrada."]);
    expect((await prisma.waConversation.findUniqueOrThrow({ where: { id: cb.id } })).unreadCount).toBe(7);
  });

  it("encerrar e reabrir; outra org não altera", async () => {
    const c = await mk(A);
    const cb = await mk(B);
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    expect((await setConversationStatus({ conversationId: c.id, status: "closed" })).ok).toBe(true);
    expect((await prisma.waConversation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("closed");
    expect((await setConversationStatus({ conversationId: c.id, status: "waiting" })).ok).toBe(true);
    expect(errs(await setConversationStatus({ conversationId: cb.id, status: "closed" }))?._form).toEqual(["Conversa não encontrada."]);
    expect((await prisma.waConversation.findUniqueOrThrow({ where: { id: cb.id } })).status).toBe("waiting");
    expect(errs(await setConversationStatus({ conversationId: c.id, status: "deleted" }))).toBeTruthy();
  });

  it("platform_admin recusado", async () => {
    const c = await mk();
    const admin = await prisma.user.create({ data: { name: "zz adm", email: `zz-adm-${randomUUID()}@test.local`, role: "platform_admin" } });
    await signInAs(admin.id, { orgId: null, platformRole: "platform_admin" });
    expect(errs(await markConversationRead({ conversationId: c.id }))?._form).toEqual(["Sem permissão."]);
    expect(errs(await setConversationStatus({ conversationId: c.id, status: "closed" }))?._form).toEqual(["Sem permissão."]);
    await prisma.user.delete({ where: { id: admin.id } });
  });
});
