import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import type { WaStatus, WhatsAppProviderKind } from "@prisma/client";

/** Sem segredos: apiKey vira `hasApiKey`; webhookToken só os 4 últimos (URL/token completos: action getInstanceWebhookConfig). */
export interface WhatsAppInstanceView {
  id: string;
  instanceName: string;
  number: string;
  provider: WhatsAppProviderKind;
  status: WaStatus;
  dailyLimit: number;
  lastError: string | null;
  lastConnectedAt: Date | null;
  hasApiKey: boolean;
  webhookTokenHint: string;
  campaignCount: number;
  createdAt: Date;
}

const select = {
  id: true, instanceName: true, number: true, provider: true, status: true, dailyLimit: true, lastError: true,
  lastConnectedAt: true, createdAt: true, apiKey: true, webhookToken: true, _count: { select: { campaigns: true } },
} as const;

type Row = {
  apiKey: string | null; webhookToken: string; _count: { campaigns: number };
} & Omit<WhatsAppInstanceView, "hasApiKey" | "webhookTokenHint" | "campaignCount">;

function view(r: Row): WhatsAppInstanceView {
  const { apiKey, webhookToken, _count, ...rest } = r;
  return { ...rest, hasApiKey: !!apiKey, webhookTokenHint: `…${webhookToken.slice(-4)}`, campaignCount: _count.campaigns };
}

export async function listWhatsAppInstances(): Promise<WhatsAppInstanceView[]> {
  await requireUser();
  return (await prisma.whatsAppInstance.findMany({ select, orderBy: { createdAt: "asc" } })).map(view);
}

export async function getWhatsAppInstance(id: string): Promise<WhatsAppInstanceView | null> {
  await requireUser();
  const r = await prisma.whatsAppInstance.findUnique({ where: { id }, select });
  return r ? view(r) : null;
}
