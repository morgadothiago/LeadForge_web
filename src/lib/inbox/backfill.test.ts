import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { prisma } from "@/lib/prisma";
import { dropInboxOrg, mkInboxOrg, mkLeadIn, type InboxOrg } from "@/lib/test-utils/inbox-fixture";
import { backfillInbox } from "./backfill";
import { buildPreview, maskPhone } from "./text";
import { decodeCursor, encodeCursor } from "./cursor";

let A: InboxOrg;
let B: InboxOrg;

beforeAll(async () => {
  A = await mkInboxOrg("bfa");
  B = await mkInboxOrg("bfb");
}, 30000);
afterAll(async () => {
  await dropInboxOrg(A);
  await dropInboxOrg(B);
});

describe("backfill (Q-068-8)", () => {
  it("cria conversas/mensagens só de Touches com externalId, é idempotente e não cruza orgs", async () => {
    const lead = await mkLeadIn(A, { name: "Ana" });
    const t0 = new Date("2026-05-01T12:00:00Z");
    const mkT = (over: Record<string, unknown>) => prisma.touch.create({ data: { leadId: lead.id, channel: "whatsapp", whatsappInstanceId: A.instanceId, ...over } });
    await mkT({ direction: "outbound", status: "delivered", externalId: "BF-OUT-1", sentAt: t0, content: "Olá" });
    await mkT({ direction: "inbound", status: "replied", externalId: "BF-IN-1", sentAt: new Date(t0.getTime() + 60_000), content: "Oi, tenho interesse" });
    await mkT({ direction: "outbound", status: "scheduled", content: "ainda não enviado" }); // sem externalId: não vira mensagem
    await mkT({ direction: "outbound", status: "skipped", content: "pulado" });
    const lb = await mkLeadIn(B);
    await prisma.touch.create({ data: { leadId: lb.id, channel: "whatsapp", whatsappInstanceId: B.instanceId, direction: "inbound", status: "replied", externalId: "BF-B-1", sentAt: t0, content: "da B" } });

    const r1 = await backfillInbox({ batchSize: 2 });
    expect(r1.messagesCreated).toBeGreaterThanOrEqual(3);
    const convA = await prisma.waConversation.findFirstOrThrow({ where: { orgId: A.orgId }, include: { messages: { orderBy: { messageAt: "asc" } } } });
    expect(convA.messages.map((m) => [m.origin, m.status, m.externalId])).toEqual([["automation", "delivered", "BF-OUT-1"], ["lead", "delivered", "BF-IN-1"]]);
    expect(convA.messages[0].touchId).not.toBeNull();
    expect(convA).toMatchObject({ unreadCount: 0, lastMessagePreview: "Oi, tenho interesse", lastMessageDirection: "inbound", status: "waiting" });
    expect(convA.lastInboundAt).toEqual(new Date(t0.getTime() + 60_000));
    const convB = await prisma.waConversation.findFirstOrThrow({ where: { orgId: B.orgId }, include: { messages: true } });
    expect(convB.messages).toHaveLength(1);
    expect(convB.messages[0].orgId).toBe(B.orgId);

    const before = await prisma.waMessage.count({ where: { orgId: { in: [A.orgId, B.orgId] } } });
    const r2 = await backfillInbox({ batchSize: 2 });
    expect(r2.messagesCreated).toBe(0);
    expect(await prisma.waMessage.count({ where: { orgId: { in: [A.orgId, B.orgId] } } })).toBe(before);
    expect(await prisma.waConversation.count({ where: { orgId: A.orgId } })).toBe(1);
  });
});

describe("migration 068a", () => {
  const SQL = readFileSync(path.join(process.cwd(), "prisma/migrations/20261021120000_inbox_whatsapp_068a/migration.sql"), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("é aditiva: só CREATE TYPE/TABLE/INDEX e FKs das tabelas novas (sem DROP/UPDATE/DELETE/TRUNCATE nem ALTER em tabela existente)", () => {
    expect(SQL.replace(/ON (DELETE|UPDATE) (CASCADE|RESTRICT|SET NULL)/g, "")).not.toMatch(/\b(DROP|UPDATE|DELETE|TRUNCATE|INSERT)\b/i);
    expect(new Set(SQL.match(/ALTER TABLE "[A-Za-z]+"/g))).toEqual(new Set(['ALTER TABLE "WaConversation"', 'ALTER TABLE "WaMessage"']));
  });

  it("aplicada no banco *_test novo: tabelas, uniques e FKs esperadas; a pasta de migrations não tem outra alteração de schema", async () => {
    const idx = (await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename IN ('WaConversation','WaMessage')`).map((i) => i.indexname);
    expect(idx).toEqual(expect.arrayContaining(["WaConversation_whatsappInstanceId_contactPhone_key", "WaMessage_whatsappInstanceId_externalId_key", "WaMessage_orgId_clientMessageId_key", "WaConversation_orgId_status_lastMessageAt_idx", "WaMessage_conversationId_messageAt_id_idx"]));
    const fk = await prisma.$queryRaw<{ name: string; rule: string }[]>`SELECT constraint_name AS name, delete_rule AS rule FROM information_schema.referential_constraints WHERE constraint_name LIKE 'WaConversation_%fkey' OR constraint_name LIKE 'WaMessage_%fkey'`;
    const rule = Object.fromEntries(fk.map((f) => [f.name, f.rule]));
    expect(rule["WaConversation_orgId_fkey"]).toBe("RESTRICT");
    expect(rule["WaConversation_leadId_fkey"]).toBe("CASCADE");
    expect(rule["WaMessage_conversationId_fkey"]).toBe("CASCADE");
    expect(rule["WaMessage_sentByUserId_fkey"]).toBe("SET NULL");
    expect(rule["WaMessage_touchId_fkey"]).toBe("SET NULL");
  });

  it("NULL em externalId/clientMessageId pode repetir (unique parcial por natureza)", async () => {
    const lead = await mkLeadIn(A);
    const conv = await prisma.waConversation.create({ data: { orgId: A.orgId, whatsappInstanceId: A.instanceId, leadId: lead.id, contactPhone: lead.phone!, lastMessageAt: new Date() } });
    const base = { orgId: A.orgId, conversationId: conv.id, whatsappInstanceId: A.instanceId, direction: "outbound" as const, origin: "manual" as const, status: "sent" as const, messageAt: new Date() };
    await prisma.waMessage.createMany({ data: [base, base] });
    expect(await prisma.waMessage.count({ where: { conversationId: conv.id } })).toBe(2);
  });
});

describe("helpers", () => {
  it("buildPreview sanitiza HTML/controle e trunca em 120; maskPhone não expõe o meio; cursor é opaco e validado", () => {
    expect(buildPreview("<b>oi</b>\n\n  tudo\tbem")).toBe("oi tudo bem");
    expect(buildPreview("a".repeat(200))).toHaveLength(120);
    expect(buildPreview("   ")).toBeNull();
    expect(maskPhone("+5511988887777")).toBe("+55 11 9****-7777");
    const at = new Date("2026-06-10T12:00:00.123Z");
    const id = "0b5d6b0e-6f0c-4f3e-9d2c-1a2b3c4d5e6f";
    expect(decodeCursor(encodeCursor(at, id))).toEqual({ at, id });
    expect(decodeCursor("lixo")).toBeNull();
    expect(decodeCursor(Buffer.from("123|nao-uuid").toString("base64url"))).toBeNull();
  });
});
