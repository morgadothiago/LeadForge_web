import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
const fake = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/whatsapp/provider", async (orig) => ({ ...(await orig<typeof import("@/lib/whatsapp/provider")>()), getWhatsAppProvider: () => fake.current }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.APP_BASE_URL = "http://app.test";

import { prisma } from "@/lib/prisma";
import { purgeTestCampaigns } from "@/lib/test-utils/purge";
import { signInAsSeedAdmin } from "@/lib/auth/test-helpers";
import { seed } from "../../../prisma/seed";
import { AppError } from "@/lib/errors";
import { FakeWhatsAppProvider } from "@/lib/whatsapp/providers/fake";
import { confirmOptOut, dismissPossibleOptOut, getInstanceWebhookConfig, rotateWebhookToken } from "./whatsapp";
import { getLead, listLeads } from "@/lib/queries/leads";
import { getPipelineBoard } from "@/lib/queries/pipeline";

const TAG = "zz-spec012act";
let f: FakeWhatsAppProvider;
let campId = "";
let instId = "";
const OLD = randomBytes(32).toString("base64url");

beforeAll(async () => {
  await purgeTestCampaigns(TAG);
  await seed(prisma);
  await signInAsSeedAdmin();
  const user = await prisma.user.findFirstOrThrow({ where: { email: "admin@leadforge.local" } });
  const icp = await prisma.icpProfile.findFirstOrThrow();
  const seq = await prisma.sequence.create({ data: { name: TAG } });
  instId = (await prisma.whatsAppInstance.create({ data: { instanceName: TAG, number: "+5511999990002", webhookToken: OLD } })).id;
  campId = (await prisma.campaign.create({ data: { name: TAG, userId: user.id, icpId: icp.id, sequenceId: seq.id, whatsappInstanceId: instId } })).id;
}, 30000);
afterAll(async () => {
  await purgeTestCampaigns(TAG).catch(() => {});
  await prisma.suppression.deleteMany({ where: { leadId: { in: (await prisma.lead.findMany({ where: { campaignId: campId }, select: { id: true } })).map((l) => l.id) } } });
  await prisma.lead.deleteMany({ where: { campaignId: campId } });
  await prisma.campaign.deleteMany({ where: { id: campId } });
  await prisma.sequence.deleteMany({ where: { name: TAG } });
  await prisma.whatsAppInstance.deleteMany({ where: { instanceName: TAG } });
  await prisma.$disconnect();
});

describe("rotateWebhookToken", () => {
  it("reconfigura o provider e troca o token; antigo invalidado; retorno mascarado", async () => {
    f = new FakeWhatsAppProvider();
    fake.current = f;
    const r = await rotateWebhookToken(instId);
    const row = await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: instId } });
    expect(row.webhookToken).not.toBe(OLD);
    expect(Buffer.from(row.webhookToken, "base64url")).toHaveLength(32);
    expect(f.configured).toEqual([{ instanceName: TAG, webhookUrl: `http://app.test/api/webhooks/whatsapp/${row.webhookToken}` }]);
    expect(r).toEqual({ ok: true, data: { webhookUrl: `http://app.test/api/webhooks/whatsapp/…${row.webhookToken.slice(-4)}`, tokenHint: `…${row.webhookToken.slice(-4)}` } });
    expect(JSON.stringify(r)).not.toContain(row.webhookToken);
    expect(await prisma.whatsAppInstance.findUnique({ where: { webhookToken: OLD } })).toBeNull();
    const cfg = await getInstanceWebhookConfig(instId);
    expect(cfg).toMatchObject({ ok: true, data: { token: row.webhookToken } });
  });
  it("falha do provider NÃO troca o token e devolve erro PT-BR", async () => {
    f = new FakeWhatsAppProvider();
    f.configureError = new AppError({ code: "upstream", userMessage: "O WhatsApp (Evolution) está indisponível." });
    fake.current = f;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const before = (await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: instId } })).webhookToken;
    const r = await rotateWebhookToken(instId);
    expect(r).toEqual({ ok: false, errors: { _form: ["O WhatsApp (Evolution) está indisponível."] } });
    expect((await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: instId } })).webhookToken).toBe(before);
  });
  it("falha ao gravar no banco reverte o provider para a URL antiga", async () => {
    f = new FakeWhatsAppProvider();
    fake.current = f;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const before = (await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: instId } })).webhookToken;
    vi.spyOn(prisma.whatsAppInstance, "updateMany").mockRejectedValueOnce(new Error("db down"));
    const r = await rotateWebhookToken(instId);
    expect(r.ok).toBe(false);
    expect(f.configured).toHaveLength(2);
    expect(f.configured[1].webhookUrl).toBe(`http://app.test/api/webhooks/whatsapp/${before}`);
    expect((await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: instId } })).webhookToken).toBe(before);
  });
  it("id inexistente/ inválido", async () => {
    fake.current = new FakeWhatsAppProvider();
    expect((await rotateWebhookToken("00000000-0000-4000-8000-000000000000")).ok).toBe(false);
    expect((await rotateWebhookToken("x")).ok).toBe(false);
  });
});

describe("confirmOptOut / dismissPossibleOptOut / queries de resposta", () => {
  async function mk() {
    const lead = await prisma.lead.create({ data: { campaignId: campId, name: "Ana", sequenceStatus: "paused_replied", possibleOptOut: true, phone: `+5511977${Date.now() % 1000000}` } });
    const opp = await prisma.opportunity.create({ data: { leadId: lead.id, campaignId: campId, stage: "contactado" } });
    await prisma.touch.create({ data: { leadId: lead.id, channel: "whatsapp", status: "pending" } });
    await prisma.touch.create({ data: { leadId: lead.id, channel: "whatsapp", direction: "inbound", status: "replied", content: `<b>para</b> de me mandar ${"x".repeat(300)}`, repliedAt: new Date() } });
    return { lead, opp };
  }
  it("confirmOptOut: mesmo efeito do automático; idempotente", async () => {
    const { lead, opp } = await mk();
    expect(await confirmOptOut(lead.id)).toEqual({ ok: true, data: { id: lead.id } });
    expect((await confirmOptOut(lead.id)).ok).toBe(true);
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { touches: true } });
    expect(l).toMatchObject({ sequenceStatus: "opted_out", possibleOptOut: false });
    expect(l.optedOutAt).not.toBeNull();
    expect(l.touches.filter((t) => t.direction === "outbound").every((t) => t.status === "skipped")).toBe(true);
    expect(await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).toMatchObject({ stage: "perdido", lostReason: "Opt-out por WhatsApp" });
    expect((await confirmOptOut("00000000-0000-4000-8000-000000000000")).ok).toBe(false);
  });
  it("dismissPossibleOptOut limpa o alerta sem outros efeitos", async () => {
    const { lead, opp } = await mk();
    expect((await dismissPossibleOptOut(lead.id)).ok).toBe(true);
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ possibleOptOut: false, sequenceStatus: "paused_replied" });
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).stage).toBe("contactado");
    expect((await dismissPossibleOptOut("00000000-0000-4000-8000-000000000000")).ok).toBe(false);
  });
  it("getPipelineBoard / listLeads / getLead trazem lastInboundAt, lastInboundText (200, sem HTML) e possibleOptOut", async () => {
    const { lead } = await mk();
    const board = await getPipelineBoard({ campaignId: campId });
    const card = board.flatMap((c) => c.cards).find((c) => c.lead.id === lead.id)!;
    expect(card.possibleOptOut).toBe(true);
    expect(card.lastInboundAt).toBeInstanceOf(Date);
    expect(card.lastInboundText).toHaveLength(200);
    expect(card.lastInboundText).not.toMatch(/[<>]/);
    expect(card.lastInboundText!.startsWith("para de me mandar")).toBe(true);
    const list = await listLeads({ campaignId: campId });
    const item = list.items.find((i) => i.id === lead.id)!;
    expect(item).toMatchObject({ possibleOptOut: true });
    expect(item.lastInboundText).toBe(card.lastInboundText);
    const d = await getLead(lead.id);
    expect(d).toMatchObject({ possibleOptOut: true });
    expect(d!.lastInboundText).toBe(card.lastInboundText);
    expect(d!.lastInboundAt).toBeInstanceOf(Date);
    const empty = await prisma.lead.create({ data: { campaignId: campId, name: "Sem resposta" } });
    expect((await getLead(empty.id))).toMatchObject({ lastInboundAt: null, lastInboundText: null, possibleOptOut: false });
  });
});
