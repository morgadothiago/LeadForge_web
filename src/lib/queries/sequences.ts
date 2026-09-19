import type { Channel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { renderTemplate, type RenderResult, type TemplateVars } from "@/lib/templates/render";

export interface SequenceListItem {
  id: string;
  name: string;
  createdAt: Date;
  stepCount: number;
  days: number[];
  campaignCount: number;
  activeCampaignCount: number;
}

export async function listSequences(): Promise<SequenceListItem[]> {
  const rows = await prisma.sequence.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      steps: { orderBy: { order: "asc" }, select: { day: true } },
      campaigns: { select: { status: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    stepCount: r.steps.length,
    days: r.steps.map((s) => s.day),
    campaignCount: r.campaigns.length,
    activeCampaignCount: r.campaigns.filter((c) => c.status === "active").length,
  }));
}

export interface SequenceDetail {
  id: string;
  name: string;
  campaigns: { id: string; name: string; status: string }[];
  steps: {
    id: string;
    order: number;
    day: number;
    channel: Channel;
    template: { id: string; name: string; campaignId: string; subject: string | null; body: string };
  }[];
}

export async function getSequence(id: string): Promise<SequenceDetail | null> {
  return prisma.sequence.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      campaigns: { select: { id: true, name: true, status: true } },
      steps: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          day: true,
          channel: true,
          template: { select: { id: true, name: true, campaignId: true, subject: true, body: true } },
        },
      },
    },
  });
}

export interface TemplateListItem {
  id: string;
  campaignId: string;
  channel: Channel;
  name: string;
  subject: string | null;
  body: string;
  createdAt: Date;
  usedInSteps: number;
}

export async function listTemplates(campaignId: string, channel?: Channel): Promise<TemplateListItem[]> {
  const rows = await prisma.messageTemplate.findMany({
    where: { campaignId, ...(channel ? { channel } : {}) },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { steps: true } } },
  });
  return rows.map(({ _count, ...t }) => ({ ...t, usedInSteps: _count.steps }));
}

export const SAMPLE_LEAD: Required<TemplateVars> = {
  name: "Maria Silva",
  firstName: "Maria",
  company: "Acme Ltda",
  email: "maria@acme.com",
  phone: "+5511999990000",
  website: "https://acme.com",
};

export interface StepPreview {
  stepId: string;
  order: number;
  day: number;
  channel: Channel;
  subject: RenderResult | null;
  body: RenderResult;
}

/** Preview server-side por step (uma query). Lead de exemplo por padrão; `lead` real opcional. */
export async function previewSequence(id: string, lead: TemplateVars = SAMPLE_LEAD): Promise<StepPreview[] | null> {
  const seq = await getSequence(id);
  if (!seq) return null;
  const vars: TemplateVars = { ...lead, firstName: lead.firstName ?? lead.name?.split(/\s+/)[0] };
  return seq.steps.map((s) => ({
    stepId: s.id,
    order: s.order,
    day: s.day,
    channel: s.channel,
    subject: s.template.subject ? renderTemplate(s.template.subject, vars, { channel: s.channel, field: "subject" }) : null,
    body: renderTemplate(s.template.body, vars, { channel: s.channel, field: "body" }),
  }));
}
