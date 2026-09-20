import type { InstanceHealth, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { stepDownWarmupStart } from "./warmup";

/**
 * Saúde da instância e disjuntor (SPEC-017). Proxies de risco (denúncia/bloqueio NÃO são visíveis): entrega, falhas, desconexões, opt-out.
 * Amostra mínima: entrega >= 10 envios (últimos 20, com >= 10 min de idade para o ACK chegar); opt-out >= 20 envios para PAUSAR
 * (>= 10 para `warning`). Falhas consecutivas e desconexão não exigem amostra.
 */
export const HEALTH = {
  WINDOW_SENDS: 50,
  DELIVERY_WINDOW: 20,
  WINDOW_DAYS: 7,
  DELIVERY_GRACE_MS: 10 * 60_000,
  MIN_SAMPLE_DELIVERY: 10,
  MIN_SAMPLE_OPTOUT_PAUSE: 20,
  MIN_SAMPLE_OPTOUT_WARN: 10,
  PAUSE_DELIVERY_BELOW: 0.8,
  WARN_DELIVERY_BELOW: 0.9,
  PAUSE_OPTOUT_ABOVE: 0.05,
  WARN_OPTOUT_ABOVE: 0.02,
  PAUSE_CONSECUTIVE_FAILURES: 2,
  PAUSE_HOURS: 24,
  LOGOUT_PAUSE_HOURS: 48,
} as const;

type Db = Prisma.TransactionClient | PrismaClient;

export interface HealthMetrics {
  /** Envios na janela (últimos 50 / 7 dias, desde a última retomada). */
  sends: number;
  /** Entregas / amostra dos últimos 20 já "maduros"; null se amostra < mínimo. */
  deliveryRate: number | null;
  deliverySample: number;
  consecutiveFailures: number;
  replyRate: number | null;
  /** Leads com opt-out ou possível opt-out / leads distintos da janela; null sem envios. */
  optOutRate: number | null;
  optOutSample: number;
}

export interface HealthDecision {
  state: InstanceHealth;
  /** Presente quando deve pausar. */
  pause?: { reason: string; hours: number };
  warnings: string[];
}

/** Pura: decide o estado a partir das métricas. */
export function decideHealth(m: HealthMetrics): HealthDecision {
  const warnings: string[] = [];
  if (m.consecutiveFailures >= HEALTH.PAUSE_CONSECUTIVE_FAILURES) {
    return { state: "paused", pause: { reason: `${m.consecutiveFailures} falhas de envio consecutivas.`, hours: HEALTH.PAUSE_HOURS }, warnings };
  }
  if (m.deliveryRate !== null && m.deliveryRate < HEALTH.PAUSE_DELIVERY_BELOW) {
    return { state: "paused", pause: { reason: `Taxa de entrega ${Math.round(m.deliveryRate * 100)}% (< 80%) nos últimos ${m.deliverySample} envios.`, hours: HEALTH.PAUSE_HOURS }, warnings };
  }
  if (m.optOutRate !== null && m.optOutSample >= HEALTH.MIN_SAMPLE_OPTOUT_PAUSE && m.optOutRate > HEALTH.PAUSE_OPTOUT_ABOVE) {
    return { state: "paused", pause: { reason: `Opt-out/possível opt-out em ${Math.round(m.optOutRate * 100)}% dos envios (> 5%).`, hours: HEALTH.PAUSE_HOURS }, warnings };
  }
  if (m.consecutiveFailures === 1) warnings.push("Última tentativa de envio falhou.");
  if (m.deliveryRate !== null && m.deliveryRate < HEALTH.WARN_DELIVERY_BELOW) warnings.push(`Taxa de entrega em ${Math.round(m.deliveryRate * 100)}%.`);
  if (m.optOutRate !== null && m.optOutSample >= HEALTH.MIN_SAMPLE_OPTOUT_WARN && m.optOutRate > HEALTH.WARN_OPTOUT_ABOVE) warnings.push(`Opt-out/possível opt-out em ${Math.round(m.optOutRate * 100)}% dos envios.`);
  return { state: warnings.length ? "warning" : "good", warnings };
}

export interface SendRow { status: string; leadId: string; sentAt: Date; lead: { optedOutAt: Date | null; possibleOptOut: boolean } }

/** Calculo PURO das metricas (compartilhado entre computeHealthMetrics e o lote do mobile, SPEC-022). `sends`: mais recentes primeiro; `recentStatuses`: 5 ultimos por updatedAt desc. */
export function buildHealthMetrics(sends: SendRow[], recentStatuses: string[], inbound: number, now: Date): HealthMetrics {
  const mature = sends.filter((s) => s.sentAt.getTime() <= now.getTime() - HEALTH.DELIVERY_GRACE_MS).slice(0, HEALTH.DELIVERY_WINDOW);
  const delivered = mature.filter((s) => s.status === "delivered").length;
  const deliveryRate = mature.length >= HEALTH.MIN_SAMPLE_DELIVERY ? delivered / mature.length : null;
  let consecutiveFailures = 0;
  for (const st of recentStatuses) { if (st === "failed") consecutiveFailures++; else break; }
  const leads = new Map(sends.map((s) => [s.leadId, s.lead]));
  const opted = [...leads.values()].filter((l) => l.optedOutAt || l.possibleOptOut).length;
  const optOutRate = leads.size ? opted / leads.size : null;
  return {
    sends: sends.length,
    deliveryRate, deliverySample: mature.length,
    consecutiveFailures,
    replyRate: sends.length ? Math.min(1, inbound / sends.length) : null,
    optOutRate, optOutSample: leads.size,
  };
}

export async function computeHealthMetrics(instanceId: string, now: Date, db: Db = prisma): Promise<HealthMetrics> {
  const inst = await db.whatsAppInstance.findUnique({ where: { id: instanceId }, select: { healthResetAt: true } });
  const weekAgo = now.getTime() - HEALTH.WINDOW_DAYS * 24 * 3600_000;
  const since = new Date(Math.max(weekAgo, inst?.healthResetAt?.getTime() ?? 0));
  const base = { whatsappInstanceId: instanceId, channel: "whatsapp", direction: "outbound" } as const;

  const sends = await db.touch.findMany({
    where: { ...base, sentAt: { not: null, gte: since } },
    orderBy: { sentAt: "desc" }, take: HEALTH.WINDOW_SENDS,
    select: { status: true, leadId: true, sentAt: true, lead: { select: { optedOutAt: true, possibleOptOut: true } } },
  });
  const recent = await db.touch.findMany({
    where: { ...base, status: { in: ["sent", "delivered", "failed"] }, updatedAt: { gte: since } },
    orderBy: { updatedAt: "desc" }, take: 5, select: { status: true },
  });
  const inbound = sends.length
    ? await db.touch.count({ where: { whatsappInstanceId: instanceId, channel: "whatsapp", direction: "inbound", createdAt: { gte: since } } })
    : 0;
  return buildHealthMetrics(sends.map((s) => ({ ...s, sentAt: s.sentAt! })), recent.map((r) => r.status), inbound, now);
}

async function alert(db: Db, instanceId: string, kind: string, message: string): Promise<void> {
  await db.instanceAlert.create({ data: { instanceId, kind, message } });
}

/** Pausa a instância (idempotente se já pausada por prazo maior) e registra alerta para o painel. Sem e-mail (fora de escopo agora). */
export async function pauseInstance(instanceId: string, reason: string, hours: number, now: Date, db: Db = prisma): Promise<Date> {
  const until = new Date(now.getTime() + hours * 3600_000);
  const cur = await db.whatsAppInstance.findUnique({ where: { id: instanceId }, select: { health: true, pausedUntil: true } });
  if (cur?.health === "paused" && cur.pausedUntil && cur.pausedUntil.getTime() >= until.getTime()) return cur.pausedUntil;
  await db.whatsAppInstance.update({ where: { id: instanceId }, data: { health: "paused", pausedUntil: until, pausedReason: reason.slice(0, 300) } });
  await alert(db, instanceId, "paused", `Instância pausada por ${hours}h: ${reason}`);
  return until;
}

/** Retoma (manual ou após o prazo): health good, limpa pausa, zera janela de métricas e recua a rampa UM degrau. */
export async function resumeInstanceNow(instanceId: string, now: Date, source: "manual" | "auto", db: Db = prisma): Promise<boolean> {
  const inst = await db.whatsAppInstance.findUnique({ where: { id: instanceId }, select: { warmupStartedAt: true } });
  if (!inst) return false;
  await db.whatsAppInstance.update({
    where: { id: instanceId },
    data: { health: "good", pausedUntil: null, pausedReason: null, healthResetAt: now, warmupStartedAt: stepDownWarmupStart(inst.warmupStartedAt, now) },
  });
  await alert(db, instanceId, "resumed", source === "auto" ? "Instância retomada automaticamente com rampa reduzida." : "Instância retomada manualmente com rampa reduzida.");
  return true;
}

/** Avalia e persiste o estado. Retoma automaticamente se a pausa venceu. Nunca lança (saúde não pode derrubar o envio). */
export async function evaluateInstanceHealth(instanceId: string, now: Date = new Date()): Promise<InstanceHealth> {
  try {
    const inst = await prisma.whatsAppInstance.findUnique({ where: { id: instanceId }, select: { health: true, pausedUntil: true, status: true, disconnectedAt: true } });
    if (!inst) return "good";
    const down = decideDisconnectPause(inst, now);
    if (down) {
      await pauseInstance(instanceId, down.reason, down.hours, now);
      return "paused";
    }
    if (inst.health === "paused") {
      if (inst.pausedUntil && inst.pausedUntil.getTime() > now.getTime()) return "paused";
      await resumeInstanceNow(instanceId, now, "auto");
    }
    const decision = decideHealth(await computeHealthMetrics(instanceId, now));
    if (decision.pause) {
      await pauseInstance(instanceId, decision.pause.reason, decision.pause.hours, now);
      return "paused";
    }
    await prisma.whatsAppInstance.updateMany({ where: { id: instanceId, health: { not: decision.state } }, data: { health: decision.state } });
    return decision.state;
  } catch (e) {
    console.error("[whatsapp-health] avaliação falhou:", e instanceof Error ? e.message : "erro");
    return "good";
  }
}

/** Para o scheduler (SPEC-013): reavalia todas as instâncias conectadas ou pausadas (retomada automática incluída). */
export async function evaluateAllInstances(now: Date = new Date()): Promise<number> {
  const rows = await prisma.whatsAppInstance.findMany({ where: { OR: [{ status: "connected" }, { health: "paused" }, { disconnectedAt: { not: null } }] }, select: { id: true } });
  for (const r of rows) await evaluateInstanceHealth(r.id, now);
  return rows.length;
}

/** 1ª transição para connected: marca o início do aquecimento (só se ainda não marcado). */
export async function ensureWarmupStarted(instanceId: string, now: Date, db: Db = prisma): Promise<void> {
  await db.whatsAppInstance.updateMany({ where: { id: instanceId, warmupStartedAt: null }, data: { warmupStartedAt: now } });
}

/** Minutos contínuos desconectada (sem logout confirmado) antes de pausar. Configurável: WHATSAPP_DISCONNECT_GRACE_MINUTES (default 10). */
export function disconnectGraceMs(): number {
  const n = Number(process.env.WHATSAPP_DISCONNECT_GRACE_MINUTES);
  return (Number.isFinite(n) && n > 0 ? n : 10) * 60_000;
}

export interface ConnectionTransition {
  /** Novo valor de `disconnectedAt` (null = conectada/limpa). */
  disconnectedAt: Date | null;
  /** Pausa imediata (logout confirmado). */
  pauseNow?: { reason: string; hours: number };
  /** Reconectou depois de uma queda: no máximo UM alerta `warning`. */
  warnReconnected?: boolean;
}

/**
 * Máquina de estados PURA da conexão (SPEC-017).
 * - logout confirmado (`loggedOut`) -> pausa imediata de 48 h;
 * - queda simples (conectada -> desconectada/connecting) -> só registra o início (`disconnectedAt`); a pausa vem de `decideDisconnectPause`;
 * - reconexão limpa `disconnectedAt` sem pausar e sinaliza um único warning (só se havia queda registrada).
 */
export function connectionTransition(
  prev: { status: string; disconnectedAt: Date | null },
  next: "connected" | "connecting" | "disconnected",
  now: Date,
  loggedOut = false,
): ConnectionTransition {
  if (next === "connected") return { disconnectedAt: null, warnReconnected: prev.disconnectedAt !== null };
  if (loggedOut && next === "disconnected") {
    return { disconnectedAt: null, pauseNow: { reason: "Sessão do WhatsApp encerrada (logout confirmado).", hours: HEALTH.LOGOUT_PAUSE_HOURS } };
  }
  if (prev.disconnectedAt) return { disconnectedAt: prev.disconnectedAt };
  return { disconnectedAt: prev.status === "connected" ? now : null };
}

/** Pura: pausa só se a queda persiste por >= graceMs. */
export function decideDisconnectPause(
  inst: { status: string; disconnectedAt: Date | null },
  now: Date,
  graceMs: number = disconnectGraceMs(),
): { reason: string; hours: number } | null {
  if (inst.status === "connected" || !inst.disconnectedAt) return null;
  const mins = Math.floor((now.getTime() - inst.disconnectedAt.getTime()) / 60_000);
  if (now.getTime() - inst.disconnectedAt.getTime() < graceMs) return null;
  return { reason: `Instância desconectada há ${mins} min (queda persistente).`, hours: HEALTH.LOGOUT_PAUSE_HOURS };
}

/**
 * Evento de conexão do webhook/atualização de status. Logout confirmado pausa 48 h na hora; queda simples só marca `disconnectedAt`
 * (pausa via evaluateInstanceHealth após o período de tolerância); reconexão zera a marca.
 */
export async function onConnectionChange(
  instance: { id: string; status: string; disconnectedAt?: Date | null },
  next: "connected" | "connecting" | "disconnected",
  now: Date,
  opts: { loggedOut?: boolean } = {},
): Promise<void> {
  if (next === "connected") await ensureWarmupStarted(instance.id, now);
  const cur = await prisma.whatsAppInstance.findUnique({ where: { id: instance.id }, select: { disconnectedAt: true } });
  const t = connectionTransition({ status: instance.status, disconnectedAt: cur?.disconnectedAt ?? instance.disconnectedAt ?? null }, next, now, opts.loggedOut);
  if ((cur?.disconnectedAt ?? null)?.getTime() !== t.disconnectedAt?.getTime()) {
    await prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { disconnectedAt: t.disconnectedAt } });
  }
  if (t.warnReconnected) await alert(prisma, instance.id, "warning", "Instância reconectou após uma queda de conexão.");
  if (t.pauseNow) await pauseInstance(instance.id, t.pauseNow.reason, t.pauseNow.hours, now);
}
