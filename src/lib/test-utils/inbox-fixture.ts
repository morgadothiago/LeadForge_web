import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createTestOrg, type TestOrg } from "./org-fixture";
import { mkIcp } from "./trial-fixture";

/** APENAS testes (SPEC-068a): org + instância conectada (aquecida) + campanha, com isolamento por org (ids aleatórios). */
export interface InboxOrg extends TestOrg {
  instanceId: string;
  instanceName: string;
  webhookToken: string;
  campaignId: string;
  memberUserId: string;
}

let n = 0;

export async function mkInboxOrg(tag: string): Promise<InboxOrg> {
  const org = await createTestOrg(tag);
  const instanceName = `zz-inbox-${tag}-${++n}-${randomBytes(3).toString("hex")}`;
  const webhookToken = randomBytes(32).toString("base64url");
  const inst = await prisma.whatsAppInstance.create({
    data: { orgId: org.orgId, instanceName, number: "+5511999990000", webhookToken, status: "connected", warmupStartedAt: new Date("2026-01-01T00:00:00Z"), dailyLimit: 30 },
  });
  const icpId = await mkIcp(org);
  const camp = await prisma.campaign.create({ data: { orgId: org.orgId, name: `zz-inbox-${tag}`, userId: org.userId, icpId, status: "paused", whatsappInstanceId: inst.id } });
  const memberUserId = randomUUID();
  await prisma.user.create({ data: { id: memberUserId, name: `zz-${tag} member`, email: `zz-${tag}-member-${memberUserId.slice(0, 8)}@test.local`, role: "provider" } });
  await prisma.membership.create({ data: { userId: memberUserId, orgId: org.orgId, orgRole: "member" } });
  return { ...org, instanceId: inst.id, instanceName, webhookToken, campaignId: camp.id, memberUserId };
}

export async function dropInboxOrg(org: InboxOrg): Promise<void> {
  await prisma.waMessage.deleteMany({ where: { orgId: org.orgId } }).catch(() => {});
  await prisma.waConversation.deleteMany({ where: { orgId: org.orgId } }).catch(() => {});
  await prisma.webhookEvent.deleteMany({ where: { orgId: org.orgId } }).catch(() => {});
  await prisma.usageCounter.deleteMany({ where: { orgId: org.orgId } }).catch(() => {});
  await prisma.orgAuditLog.deleteMany({ where: { orgId: org.orgId } }).catch(() => {});
  const { purgeTestOrg } = await import("./org-fixture");
  await prisma.membership.deleteMany({ where: { userId: org.memberUserId } }).catch(() => {});
  await purgeTestOrg(org);
  await prisma.user.deleteMany({ where: { id: org.memberUserId } }).catch(() => {});
}

let phoneSeq = 0;
/** Celular BR único (+5511 9 dddd dddd). */
export function uniquePhone(): string {
  phoneSeq++;
  return `+55119${String(60000000 + ((Date.now() % 1000000) * 31 + phoneSeq * 7919) % 39999999).padStart(8, "0")}`;
}

export function jidOf(e164: string): string {
  return `${e164.replace(/\D/g, "")}@s.whatsapp.net`;
}

export async function mkLeadIn(org: InboxOrg, over: Record<string, unknown> = {}) {
  const phone = (over.phone as string | undefined) ?? uniquePhone();
  return prisma.lead.create({ data: { campaignId: org.campaignId, name: "Joao Zz", phone, sequenceStatus: "active", ...over } });
}

/** Conversa já existente (como se o lead tivesse escrito em `lastInboundAt`). */
export async function mkConversation(org: InboxOrg, opts: { leadId: string; phone: string; lastInboundAt?: Date | null; lastMessageAt?: Date; status?: "waiting" | "attending" | "closed"; unreadCount?: number; preview?: string }) {
  const at = opts.lastMessageAt ?? opts.lastInboundAt ?? new Date();
  return prisma.waConversation.create({
    data: {
      orgId: org.orgId, whatsappInstanceId: org.instanceId, leadId: opts.leadId, contactPhone: opts.phone, status: opts.status ?? "waiting", unreadCount: opts.unreadCount ?? 0,
      lastMessageAt: at, lastInboundAt: opts.lastInboundAt === undefined ? at : opts.lastInboundAt, lastMessagePreview: opts.preview ?? "oi", lastMessageDirection: "inbound",
    },
  });
}

/** Payload `messages.upsert` da Evolution (formato do parser existente). */
export function upsertBody(org: InboxOrg, phone: string, text: string, over: { id?: string; fromMe?: boolean; ts?: number } = {}) {
  return {
    event: "messages.upsert", instance: org.instanceName,
    data: { key: { id: over.id ?? `M${randomBytes(6).toString("hex")}`, remoteJid: jidOf(phone), fromMe: over.fromMe ?? false }, pushName: "Joao", message: { conversation: text }, messageTimestamp: over.ts ?? Math.floor(Date.now() / 1000) },
  };
}

export function updateBody(org: InboxOrg, externalId: string, status: string) {
  return { event: "messages.update", instance: org.instanceName, data: { keyId: externalId, status } };
}
