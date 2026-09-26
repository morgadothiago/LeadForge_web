import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * SPEC-030 — fixture para os testes de vazamento cross-tenant ("teste obrigatório" da seção 3 do
 * spec.md): cria uma `Organization` + `User` (`provider`) + `Membership` (`owner`) dedicados, isolados
 * de qualquer outro dado de teste (ids aleatórios, nunca os `SEED_IDS` do seed principal).
 */
export interface TestOrg {
  orgId: string;
  userId: string;
  tag: string;
}

let counter = 0;

/** `tag` só para depuração (nome/slug/email); não precisa ser único — os ids são sempre aleatórios. */
export async function createTestOrg(tag: string): Promise<TestOrg> {
  const n = ++counter;
  const orgId = randomUUID();
  const userId = randomUUID();
  const slug = `zz-${tag}-${n}-${orgId.slice(0, 8)}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  await prisma.organization.create({ data: { id: orgId, name: `zz-${tag} org ${n}`, slug, status: "active" } });
  await prisma.user.create({
    data: { id: userId, name: `zz-${tag} user ${n}`, email: `zz-${tag}-${n}-${userId.slice(0, 8)}@test.local`, role: "provider" },
  });
  await prisma.membership.create({ data: { userId, orgId, orgRole: "owner" } });
  return { orgId, userId, tag };
}

/**
 * Apaga em ordem segura (filhos antes dos pais, respeitando `onDelete: Restrict`) TODO o dado
 * pendurado na org — best-effort (banco de teste é recriado do zero a cada `npm test`, então isto é
 * só higiene entre testes do mesmo arquivo, não uma garantia de isolamento).
 */
export async function purgeTestOrg(org: TestOrg): Promise<void> {
  const { orgId, userId } = org;
  try {
    const campaigns = await prisma.campaign.findMany({ where: { orgId }, select: { id: true, sequenceId: true } });
    const campaignIds = campaigns.map((c) => c.id);
    const opportunities = campaignIds.length
      ? await prisma.opportunity.findMany({ where: { campaignId: { in: campaignIds } }, select: { id: true } })
      : [];
    const oppIds = opportunities.map((o) => o.id);
    if (oppIds.length) await prisma.stageHistory.deleteMany({ where: { opportunityId: { in: oppIds } } });
    if (campaignIds.length) {
      await prisma.meeting.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await prisma.opportunity.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await prisma.draft.deleteMany({ where: { lead: { campaignId: { in: campaignIds } } } });
      await prisma.leadNote.deleteMany({ where: { lead: { campaignId: { in: campaignIds } } } });
      await prisma.touch.deleteMany({ where: { lead: { campaignId: { in: campaignIds } } } });
      await prisma.lead.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await prisma.searchRun.deleteMany({ where: { campaignId: { in: campaignIds } } });
    }
    const sequenceIds = campaigns.map((c) => c.sequenceId).filter((s): s is string => !!s);
    const orgSequences = await prisma.sequence.findMany({ where: { orgId }, select: { id: true } });
    const allSeqIds = [...new Set([...sequenceIds, ...orgSequences.map((s) => s.id)])];
    if (allSeqIds.length) await prisma.sequenceStep.deleteMany({ where: { sequenceId: { in: allSeqIds } } });
    await prisma.messageTemplate.deleteMany({ where: { orgId } });
    if (campaignIds.length) await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    if (allSeqIds.length) await prisma.sequence.deleteMany({ where: { id: { in: allSeqIds } } });
    await prisma.icpProfile.deleteMany({ where: { orgId } });

    const instances = await prisma.whatsAppInstance.findMany({ where: { orgId }, select: { id: true } });
    if (instances.length) await prisma.instanceAlert.deleteMany({ where: { instanceId: { in: instances.map((i) => i.id) } } });
    await prisma.whatsAppInstance.deleteMany({ where: { orgId } });
    await prisma.emailAccount.deleteMany({ where: { orgId } });
    await prisma.suppression.deleteMany({ where: { orgId } });
    await prisma.schedulerRun.deleteMany({ where: { orgId } });
    await prisma.integrationAuditLog.deleteMany({ where: { orgId } });
    await prisma.integrationSecret.deleteMany({ where: { orgId } });

    const agents = await prisma.agent.findMany({ where: { orgId }, select: { id: true } });
    if (agents.length) {
      await prisma.agentRun.deleteMany({ where: { agentId: { in: agents.map((a) => a.id) } } });
      await prisma.knowledgeDocument.deleteMany({ where: { orgId } });
    }
    await prisma.agent.deleteMany({ where: { orgId } });
    await prisma.agentSettings.deleteMany({ where: { orgId } });
    await prisma.meetingSettings.deleteMany({ where: { orgId } });
    await prisma.webhookEvent.deleteMany({ where: { orgId } });

    await prisma.membership.deleteMany({ where: { orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  } catch {
    // best-effort: nunca derruba a suíte por causa de limpeza (banco de teste é recriado do zero a cada run).
  }
}
