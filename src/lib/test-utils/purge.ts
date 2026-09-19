import { prisma } from "@/lib/prisma";

/**
 * Remove campanhas de teste cujo nome começa com `prefix` (e leads/passos/templates dependentes). Só aceita prefixos `zz-`.
 * Usado em beforeAll (resíduo de execução abortada) e afterAll (mesmo se o teste falhar): não depende de ids em memória.
 */
export async function purgeTestCampaigns(prefix: string): Promise<number> {
  if (!prefix.startsWith("zz-")) throw new Error("purgeTestCampaigns: prefixo deve começar com 'zz-'.");
  const cs = await prisma.campaign.findMany({ where: { name: { startsWith: prefix } }, select: { id: true, sequenceId: true } });
  if (!cs.length) return 0;
  const ids = cs.map((c) => c.id);
  const seqIds = cs.map((c) => c.sequenceId).filter((s): s is string => !!s);
  await prisma.lead.deleteMany({ where: { campaignId: { in: ids } } });
  if (seqIds.length) await prisma.sequenceStep.deleteMany({ where: { sequenceId: { in: seqIds } } });
  await prisma.campaign.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}
