import type { CampaignStatus, Channel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { campaignListParamsSchema, type CampaignListParams } from "@/lib/schemas/campaign";

export interface IcpSummary {
  id: string;
  name: string;
  niche: string;
  location: string | null;
  companySize: string | null;
  signals: string[];
  keywords: string[];
  sources: string[];
  desiredData: string[];
  createdAt: Date;
  campaignCount: number;
}

export interface CampaignListItem {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  createdAt: Date;
  updatedAt: Date;
  icp: { id: string; name: string; niche: string };
  sequence: { id: string; name: string } | null;
  whatsappInstance: { id: string; instanceName: string } | null;
  leadCount: number;
  templateCount: number;
}

export interface CampaignDetail extends CampaignListItem {
  icp: IcpSummary;
  templates: { id: string; name: string; channel: Channel }[];
}

function toIcpSummary(i: {
  id: string;
  name: string;
  niche: string;
  location: string | null;
  companySize: string | null;
  signals: string[];
  keywords: string[];
  sources: string[];
  desiredData: string[];
  createdAt: Date;
  _count: { campaigns: number };
}): IcpSummary {
  const { _count, ...rest } = i;
  return { ...rest, campaignCount: _count.campaigns };
}

/** Lista com contagem de leads (1 query, sem N+1). Arquivadas ocultas por padrão. */
export async function listCampaigns(params: CampaignListParams = {}): Promise<CampaignListItem[]> {
  await requireUser();
  const { status, includeArchived } = campaignListParamsSchema.parse(params);
  const rows = await prisma.campaign.findMany({
    where: status ? { status } : includeArchived ? {} : { status: { not: "archived" } },
    orderBy: { createdAt: "desc" },
    include: {
      icp: { select: { id: true, name: true, niche: true } },
      sequence: { select: { id: true, name: true } },
      whatsappInstance: { select: { id: true, instanceName: true } },
      _count: { select: { leads: true, templates: true } },
    },
  });
  return rows.map(({ _count, ...c }) => ({ ...c, leadCount: _count.leads, templateCount: _count.templates }));
}

export async function getCampaign(id: string): Promise<CampaignDetail | null> {
  await requireUser();
  const c = await prisma.campaign.findUnique({
    where: { id },
    include: {
      icp: { include: { _count: { select: { campaigns: true } } } },
      sequence: { select: { id: true, name: true } },
      whatsappInstance: { select: { id: true, instanceName: true } },
      templates: { select: { id: true, name: true, channel: true }, orderBy: { createdAt: "asc" } },
      _count: { select: { leads: true, templates: true } },
    },
  });
  if (!c) return null;
  const { _count, icp, ...rest } = c;
  return { ...rest, icp: toIcpSummary(icp), leadCount: _count.leads, templateCount: _count.templates };
}

/** ICPs para select/gestão, com nº de campanhas que os usam. */
export async function listIcps(): Promise<IcpSummary[]> {
  await requireUser();
  const rows = await prisma.icpProfile.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { campaigns: true } } },
  });
  return rows.map(toIcpSummary);
}

export async function getIcp(id: string): Promise<IcpSummary | null> {
  await requireUser();
  const i = await prisma.icpProfile.findUnique({
    where: { id },
    include: { _count: { select: { campaigns: true } } },
  });
  return i ? toIcpSummary(i) : null;
}

/** Opções para selects (SPEC-006/011 ainda podem estar vazias). */
export async function listCampaignFormOptions(): Promise<{
  sequences: { id: string; name: string }[];
  whatsappInstances: { id: string; instanceName: string }[];
}> {
  await requireUser();
  const [sequences, whatsappInstances] = await Promise.all([
    prisma.sequence.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.whatsAppInstance.findMany({ select: { id: true, instanceName: true }, orderBy: { instanceName: "asc" } }),
  ]);
  return { sequences, whatsappInstances };
}
