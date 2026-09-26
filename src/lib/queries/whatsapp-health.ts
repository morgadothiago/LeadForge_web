import type { InstanceHealth } from "@prisma/client";
import { requireProviderOrg } from "@/lib/auth/require-admin";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import type { HealthMetrics } from "@/lib/whatsapp/health";
import { buildInstanceHealthView } from "@/lib/whatsapp/health-view";

export interface InstanceAlertView {
  id: string;
  kind: string;
  message: string;
  createdAt: Date;
  readAt: Date | null;
}
export interface InstanceHealthView {
  instanceId: string;
  state: InstanceHealth;
  pausedUntil: Date | null;
  pausedReason: string | null;
  /** Dia de aquecimento (1 = dia da 1ª conexão); null se ainda não conectou. */
  warmupDay: number | null;
  dailyLimitCeiling: number;
  /** Limite efetivo hoje = min(teto, rampa), reduzido por saúde; 0 se pausada. */
  effectiveLimitToday: number;
  sentToday: number;
  metrics: HealthMetrics;
  /** Avisos do estado `warning` (ex.: "Taxa de entrega em 85%"). */
  warnings: string[];
  alerts: InstanceAlertView[];
}

export async function getInstanceHealth(instanceId: string, now: Date = new Date()): Promise<InstanceHealthView | null> {
  const { orgId } = await requireProviderOrg();
  const inst = await scopedPrisma(orgId).whatsAppInstance.findUnique({ where: { id: instanceId } });
  if (!inst) return null;
  return buildInstanceHealthView(inst, now);
}

/** Alertas não lidos de todas as instâncias DA ORG (badge/toast do painel). */
export async function listUnreadInstanceAlerts(): Promise<(InstanceAlertView & { instanceId: string; instanceName: string })[]> {
  const { orgId } = await requireProviderOrg();
  const rows = await scopedPrisma(orgId).instanceAlert.findMany({ where: { readAt: null }, orderBy: { createdAt: "desc" }, take: 50, include: { instance: { select: { instanceName: true } } } });
  return rows.map((r: (typeof rows)[number]) => ({ id: r.id, kind: r.kind, message: r.message, createdAt: r.createdAt, readAt: r.readAt, instanceId: r.instanceId, instanceName: r.instance.instanceName }));
}
