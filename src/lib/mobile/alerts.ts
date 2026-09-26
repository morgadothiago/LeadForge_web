import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { safeErrorForLog } from "@/lib/errors";
import { budgetState, monthStart } from "@/lib/agents/budget";
import { SCHEDULER_EXPECTED_INTERVAL_MS } from "@/lib/scheduler/config";
import { redactText } from "./sanitize";
import { sendPushForAlert, type PushAlert } from "./expo-push";
import { collectMeetingReminders, REMINDER_KIND } from "./meeting-reminders";

/**
 * SPEC-023: emissor isolado de alertas. Varredura idempotente sobre o estado existente (instancias, leads, orcamento, scheduler, toques).
 * Titulo/corpo sao TEXTO FIXO por kind (nunca texto livre de erro, nome, telefone ou mensagem). Falha aqui so loga.
 */
export const ALERT_RETENTION_MS = 30 * 24 * 3600_000;
export const MAX_PUSHES_PER_SWEEP = 10;
export const PUSH_WAIT_CAP_MS = 3_000; // teto que a varredura espera pelos pushes (o resto segue em background)
export const BASELINE_KEY = "baseline:init";
export const OPT_OUT_BURST = 5; // supressoes por opt-out em 24h
const DAY = 24 * 3600_000;
const REPLY_BUCKET_MS = 5 * 60_000;

export type Severity = "critica" | "alta" | "media" | "baixa";
export interface Candidate {
  kind: string; severity: Severity; dedupeKey: string; title: string; body: string;
  refType: "instance" | "lead" | "draft" | "scheduler" | "budget" | "meeting"; refId: string | null; link?: string | null;
}

const TEXT = {
  wa_disconnected: { severity: "alta", title: "WhatsApp desconectou", body: "Uma instância de WhatsApp está desconectada. Abra o app para ver os detalhes." },
  wa_paused: { severity: "critica", title: "Instância pausada", body: "Uma instância de WhatsApp foi pausada por risco de banimento. Abra o app para ver os detalhes." },
  mass_opt_out: { severity: "alta", title: "Possível opt-out em massa", body: "Muitos contatos pediram para não receber mensagens. Abra o app para ver os detalhes." },
  handoff: { severity: "alta", title: "Precisa de você", body: "Um lead precisa de atendimento humano. Abra o app para ver os detalhes." },
  budget_alert: { severity: "media", title: "Orçamento em 80%", body: "O orçamento de agentes de IA atingiu 80% do teto mensal." },
  budget_exhausted: { severity: "alta", title: "Orçamento esgotado", body: "O orçamento de agentes de IA atingiu 100% do teto mensal." },
  scheduler_stale: { severity: "alta", title: "Scheduler parado", body: "O scheduler não executa há mais tempo que o esperado. Abra o app para ver os detalhes." },
  lead_replied: { severity: "baixa", title: "Lead respondeu", body: "Você recebeu novas respostas de leads." },
  // SPEC-028: titulo real varia por antecedencia (meeting-reminders.ts); aqui vale o texto-base fixo (sem PII).
  meeting_reminder: { severity: "media", title: "Reunião em breve", body: "Você tem uma reunião agendada. Abra o app para ver os detalhes." },
} as const satisfies Record<string, { severity: Severity; title: string; body: string }>;
type Kind = keyof typeof TEXT;
/** Todos os kinds emitidos (SPEC-028: base do teste de cobertura do mapa kind->area). */
export const ALERT_KINDS: string[] = Object.keys(TEXT);

const cand = (kind: Kind, key: string, refType: Candidate["refType"], refId: string | null, link?: string | null): Candidate => ({
  kind, severity: TEXT[kind].severity, dedupeKey: `${kind}:${key}`, title: TEXT[kind].title, body: TEXT[kind].body, refType, refId, link,
});

/** Cria o alerta se o episodio (dedupeKey) ainda nao existe. Devolve true se criou. Concorrencia: unique + P2002. Push so na criacao. */
export interface RaiseOpts { silent?: boolean; deferred?: PushAlert[] }
export async function raiseAlert(c: Candidate, opts: RaiseOpts = {}): Promise<boolean> {
  let created;
  try {
    created = await prisma.mobileAlert.create({
      data: {
        kind: c.kind, severity: c.severity, dedupeKey: c.dedupeKey, title: redactText(c.title) ?? c.title, body: redactText(c.body) ?? c.body,
        refType: c.refType, refId: c.refId, link: c.link && /^https:\/\/\S+$/.test(c.link) ? c.link.slice(0, 500) : null,
        ...(opts.silent ? { readAt: new Date() } : {}), // baseline: estado historico nasce lido e sem push
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
  if (opts.silent) return true;
  const pa = { id: created.id, kind: created.kind, title: created.title, body: created.body };
  if (opts.deferred) opts.deferred.push(pa);
  else await sendPushForAlert(pa); // nunca lanca
  return true;
}

async function resolveInactive(kind: Kind, activeKeys: string[], now: Date): Promise<void> {
  await prisma.mobileAlert.updateMany({ where: { kind, resolvedAt: null, dedupeKey: { notIn: activeKeys } }, data: { resolvedAt: now } });
}

async function collect(now: Date): Promise<Map<Kind, Candidate[]>> {
  const out = new Map<Kind, Candidate[]>();
  const add = (c: Candidate) => out.set(c.kind as Kind, [...(out.get(c.kind as Kind) ?? []), c]);
  for (const k of ["wa_disconnected", "wa_paused", "mass_opt_out", "handoff", "budget_alert", "budget_exhausted", "scheduler_stale"] as Kind[]) out.set(k, []);

  const [insts, pausedAlerts] = await Promise.all([
    prisma.whatsAppInstance.findMany({ select: { id: true, status: true, disconnectedAt: true, health: true, pausedUntil: true } }),
    prisma.instanceAlert.findMany({ where: { kind: "paused" }, orderBy: { createdAt: "desc" }, select: { instanceId: true, id: true }, take: 200 }),
  ]);
  for (const i of insts) {
    if (i.status !== "connected" && i.disconnectedAt) add(cand("wa_disconnected", `${i.id}:${i.disconnectedAt.getTime()}`, "instance", i.id));
    if (i.health === "paused") {
      const last = pausedAlerts.find((a) => a.instanceId === i.id);
      add(cand("wa_paused", `${i.id}:${last?.id ?? i.pausedUntil?.getTime() ?? "x"}`, "instance", i.id));
    }
  }

  const optOuts = await prisma.suppression.count({ where: { reason: { in: ["opt_out_reply", "opt_out_link", "opt_out_manual"] }, createdAt: { gte: new Date(now.getTime() - DAY) } } });
  if (optOuts >= OPT_OUT_BURST) add(cand("mass_opt_out", now.toISOString().slice(0, 10), "instance", null));

  const [handoffs, closer] = await Promise.all([
    prisma.lead.findMany({ where: { needsHuman: true, handoffAt: { not: null } }, orderBy: { handoffAt: "desc" }, take: 50, select: { id: true, handoffAt: true } }),
    prisma.agent.findFirst({ where: { role: "closer", callLink: { not: null } }, select: { callLink: true } }),
  ]);
  for (const l of handoffs) add(cand("handoff", `${l.id}:${l.handoffAt!.getTime()}`, "lead", l.id, closer?.callLink));

  const [settings, agents, spend] = await Promise.all([
    prisma.agentSettings.findUnique({ where: { id: "global" } }),
    prisma.agent.findMany({ select: { id: true, monthlyBudgetCents: true } }),
    prisma.agentRun.groupBy({ by: ["agentId"], where: { createdAt: { gte: monthStart(now) } }, _sum: { costMicros: true } }),
  ]);
  const spentBy = new Map(spend.map((s) => [s.agentId, s._sum.costMicros ?? 0]));
  const month = now.toISOString().slice(0, 7);
  const budgets: [string, number, number | null][] = [["global", spend.reduce((a, s) => a + (s._sum.costMicros ?? 0), 0), settings?.monthlyBudgetCents ?? null], ...agents.map((a) => [a.id, spentBy.get(a.id) ?? 0, a.monthlyBudgetCents] as [string, number, number | null])];
  for (const [id, micros, cap] of budgets) {
    const st = budgetState(micros, cap);
    if (st === "alert") add(cand("budget_alert", `${id}:${month}`, "budget", id));
    if (st === "exhausted") add(cand("budget_exhausted", `${id}:${month}`, "budget", id));
  }

  const lastOk = await prisma.schedulerRun.findFirst({ where: { status: "ok" }, orderBy: { startedAt: "desc" }, select: { finishedAt: true, startedAt: true } });
  const okAt = lastOk ? (lastOk.finishedAt ?? lastOk.startedAt) : null;
  if (okAt && now.getTime() - okAt.getTime() > 2 * SCHEDULER_EXPECTED_INTERVAL_MS) add(cand("scheduler_stale", String(okAt.getTime()), "scheduler", null));
  return out;
}

/**
 * Apaga alertas RESOLVIDOS > 30 dias e dispositivos inativos (revogados ou sem uso/refresh expirado ha > 30 dias).
 * L1: alerta de episodio ainda ativo (nao resolvido) nunca e apagado, senao a varredura o recriaria com novo push; o dedupe do episodio e mantido.
 * A linha de baseline tambem e preservada. */
export async function cleanupMobile(now: Date): Promise<{ alerts: number; devices: number }> {
  const cut = new Date(now.getTime() - ALERT_RETENTION_MS);
  const a = await prisma.mobileAlert.deleteMany({ where: { createdAt: { lt: cut }, resolvedAt: { not: null }, kind: { not: "baseline" } } });
  const d = await prisma.mobileDevice.deleteMany({ where: { OR: [{ revokedAt: { lt: cut } }, { refreshExpiresAt: { lt: cut } }] } });
  return { alerts: a.count, devices: d.count };
}

/** Linha de controle: existe = a primeira varredura (baseline) ja rodou. Nao aparece na API (lida+resolvida e filtrada por kind). */
async function ensureBaseline(now: Date): Promise<boolean> {
  if (await prisma.mobileAlert.findUnique({ where: { dedupeKey: BASELINE_KEY }, select: { id: true } })) return false;
  try {
    await prisma.mobileAlert.create({ data: { kind: "baseline", severity: "baixa", dedupeKey: BASELINE_KEY, title: "baseline", body: "baseline", refType: "scheduler", readAt: now, resolvedAt: now } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}

/** Push fora do caminho critico: no maximo MAX_PUSHES_PER_SWEEP por varredura, em background com catch; espera no maximo PUSH_WAIT_CAP_MS. */
async function dispatchPushes(list: PushAlert[]): Promise<void> {
  if (!list.length) return;
  const work = (async () => {
    for (const a of list.slice(0, MAX_PUSHES_PER_SWEEP)) await sendPushForAlert(a);
  })().catch((e) => console.warn("[mobile-alerts] push falhou:", redactText(safeErrorForLog(e))));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((r) => { timer = setTimeout(r, PUSH_WAIT_CAP_MS); })]);
  clearTimeout(timer);
}

/**
 * Varredura: gera novos episodios, resolve os que terminaram, agrupa "lead respondeu". Nunca lanca.
 * Baseline: na PRIMEIRA varredura (linha de controle ausente) todo estado ja existente vira alerta lido e SEM push.
 */
export async function sweepAlerts(now: Date = new Date()): Promise<{ raised: number }> {
  let raised = 0;
  const deferred: PushAlert[] = [];
  try {
    const silent = await ensureBaseline(now);
    const opts: RaiseOpts = { silent, deferred };
    const cands = await collect(now);
    for (const [kind, list] of cands) {
      for (const c of list) if (await raiseAlert(c, opts)) raised++;
      await resolveInactive(kind, list.map((c) => c.dedupeKey), now);
    }
    // SPEC-028: lembretes de reuniao (janelas/offsets); resolve os que deixaram de valer (cancelada, reagendada, passada).
    const reminders = await collectMeetingReminders(now);
    for (const c of reminders.candidates) if (await raiseAlert(c, { ...opts, silent: opts.silent || c.silent })) raised++;
    await prisma.mobileAlert.updateMany({ where: { kind: REMINDER_KIND, resolvedAt: null, dedupeKey: { notIn: reminders.activeKeys } }, data: { resolvedAt: now } });
    const bucket = Math.floor(now.getTime() / REPLY_BUCKET_MS);
    const replies = await prisma.touch.count({ where: { direction: "inbound", createdAt: { gte: new Date(bucket * REPLY_BUCKET_MS), lte: now } } });
    if (replies > 0 && (await raiseAlert(cand("lead_replied", String(bucket), "lead", null), opts))) raised++;
  } catch (e) {
    console.warn("[mobile-alerts] varredura falhou:", redactText(safeErrorForLog(e)));
  }
  await dispatchPushes(deferred);
  return { raised };
}

let lastSweep = 0;
let lastCleanup = 0;
/** Chamado no fim do tick e (limitado a 1x/60 s) pelas rotas de alerta, para cobrir "scheduler parado". */
export async function sweepThrottled(now: Date = new Date(), minMs = 60_000): Promise<void> {
  if (now.getTime() - lastSweep < minMs && now.getTime() >= lastSweep) return;
  lastSweep = now.getTime();
  await sweepAlerts(now);
  if (now.getTime() - lastCleanup > 3600_000 || now.getTime() < lastCleanup) {
    lastCleanup = now.getTime();
    await cleanupMobile(now).catch((e) => console.warn("[mobile-alerts] limpeza falhou:", redactText(safeErrorForLog(e))));
  }
}
export function _resetSweepThrottle(): void {
  lastSweep = 0;
  lastCleanup = 0;
}

export function alertView(a: { id: string; kind: string; severity: string; title: string; body: string; refType: string; refId: string | null; link: string | null; createdAt: Date; readAt: Date | null; resolvedAt: Date | null }) {
  return { id: a.id, kind: a.kind, severity: a.severity, title: a.title, body: a.body, refType: a.refType, refId: a.refId, link: a.link, createdAt: a.createdAt, readAt: a.readAt, resolvedAt: a.resolvedAt };
}
