import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";

/** APENAS testes (SPEC-028/030): usuario + org + campanha + lead + oportunidade com prefixo zz- e limpeza total. */
export interface MeetingFixture { userId: string; orgId: string; campId: string; leadId: string; oppId: string; email: string; phone: string; cleanup: () => Promise<void>; extraOpp: (name: string) => Promise<{ leadId: string; oppId: string }> }

export async function mkMeetingFixture(tag: string, phone = "+5511955550001"): Promise<MeetingFixture> {
  const email = `${tag}@leadforge.local`;
  const wipe = async () => {
    await prisma.mobileAlert.deleteMany({ where: { OR: [{ kind: "meeting_reminder" }, { dedupeKey: { startsWith: `zz-${tag}` } }] } });
    await prisma.webhookEvent.deleteMany({ where: { source: "meeting" } });
    const camps = await prisma.campaign.findMany({ where: { name: { startsWith: tag } }, select: { id: true, orgId: true } });
    await prisma.meeting.deleteMany({ where: { campaignId: { in: camps.map((c) => c.id) } } });
    await prisma.lead.deleteMany({ where: { campaignId: { in: camps.map((c) => c.id) } } });
    await prisma.campaign.deleteMany({ where: { name: { startsWith: tag } } });
    await prisma.icpProfile.deleteMany({ where: { name: { startsWith: tag } } });
    await prisma.meetingSettings.deleteMany({ where: { orgId: { in: camps.map((c) => c.orgId) } } });
    await prisma.membership.deleteMany({ where: { user: { email } } });
    await prisma.organization.deleteMany({ where: { slug: tag } });
    await prisma.user.deleteMany({ where: { email } });
  };
  await wipe();
  const userId = (await prisma.user.create({ data: { name: "Zz Meet", email, role: "provider", passwordHash: await hashPassword("Senha-Forte-Teste-123") } })).id;
  const orgId = (await prisma.organization.create({ data: { name: tag, slug: tag, status: "active" } })).id;
  await prisma.membership.create({ data: { userId, orgId, orgRole: "owner" } });
  const icp = await prisma.icpProfile.create({ data: { orgId, name: `${tag}-icp`, niche: "n" } });
  const campId = (await prisma.campaign.create({ data: { orgId, name: tag, icpId: icp.id, userId } })).id;
  const mkLead = async (name: string, ph: string | null) => {
    const l = await prisma.lead.create({ data: { campaignId: campId, name, phone: ph, email: `${name.replace(/\W/g, "").toLowerCase()}@x.test` } });
    const o = await prisma.opportunity.create({ data: { leadId: l.id, campaignId: campId } });
    return { leadId: l.id, oppId: o.id };
  };
  const first = await mkLead("Maria Zzreuniao Silva", phone);
  return { userId, orgId, campId, ...first, email, phone, cleanup: wipe, extraOpp: (n) => mkLead(n, null) };
}
