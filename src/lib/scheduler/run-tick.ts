import { Prisma, type Channel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { safeErrorForLog } from "@/lib/errors";
import { enqueueAgentRun, isAgentAvailable } from "@/lib/agents/queue";
import { advanceAfterAgentStep } from "@/lib/agents/advance";
import { sendEmail } from "@/lib/channels/email";
import { sendWhatsApp } from "@/lib/channels/whatsapp";
import { NEEDS_REVIEW_PREFIX } from "@/lib/channels/reserve";
import { SENDING_STALE_MS } from "@/lib/channels/email";
import { evaluateAllInstances } from "@/lib/whatsapp/health";
import { findSuppression } from "@/lib/domain/suppression";
import { allowSeedSends } from "@/lib/domain/seed-guard";
import { activateLeads, classifyStartable, writeSequenceAudit } from "@/lib/domain/sequence-start";
import { runMoveOpportunity } from "@/lib/domain/move-opportunity";
import { sweepThrottled } from "@/lib/mobile/alerts";
import { syncOrgStatuses } from "@/lib/billing/status-map";
import { purgeCanceledOrgs } from "@/lib/billing/purge";
import { sendBillingReminders } from "@/lib/billing/reminders";
import { runPixRenewalJob } from "@/lib/billing/pix-renewal";
import { getSchedulerConfig, type SchedulerConfig } from "./config";
import { acquirePgAdvisoryLock, type AcquireLock } from "./lock";
import { computeNextTouchAt, decideAfterSend, decideStage, pickDueLeads, type ChannelResult, type EndStatus } from "./decide";

/**
 * Scheduler de follow-up (SPEC-013). As decisões de janela/limites/intervalo/pausa/supressão são DOS CANAIS (SPEC-010/011/017):
 * aqui só se orquestra e se reage ao retorno tipado. Uma rodada é sequencial (=> envios serializados por instância).
 */

export interface TickDeps {
  sendWhatsApp: (touchId: string, now: Date) => Promise<ChannelResult>;
  sendEmail: (touchId: string, now: Date) => Promise<ChannelResult>;
  evaluateHealth: (now: Date) => Promise<unknown>;
  acquireLock: AcquireLock;
  config: SchedulerConfig;
  /** Relógio REAL (orçamento de tempo); `now` (parâmetro de runTick) é o tempo lógico das decisões. */
  clock: () => number;
  /** Isolamento (testes/execução dirigida): restringe às campanhas listadas. */
  campaignIds?: string[];
}

export interface TickSummary {
  status: "ok" | "locked" | "error";
  skipped?: "locked";
  runId: string | null;
  durationMs: number;
  /** Por que parou antes de esgotar a fila (deixa o resto para a próxima rodada). */
  budget: "time" | "sends" | null;
  counters: Record<string, number>;
  error?: string;
}

const defaultDeps = (): TickDeps => ({
  sendWhatsApp: (id, now) => sendWhatsApp(id, { now }),
  sendEmail: (id, now) => sendEmail(id, { now }),
  evaluateHealth: (now) => evaluateAllInstances(now),
  acquireLock: acquirePgAdvisoryLock,
  config: getSchedulerConfig(),
  clock: Date.now,
});

const SENT_LIKE = ["sent", "delivered", "replied"] as const;
const INSTANCE_LEVEL_DEFER = new Set(["daily_limit", "not_connected", "min_interval", "rate_limited", "instance_paused"]);
const SCAN_LIMIT = 200;
const AUTO_START_LIMIT = 500;
const RUN_RETENTION_MS = 30 * 24 * 3600_000;
const sanitize = (s: string) => s.replace(/\s+/g, " ").slice(0, 300);

type StepRow = { id: string; day: number; channel: Channel; order: number; agentId: string | null; agentFallbackTemplate: boolean };

/**
 * SPEC-030: o tick itera por Organization ATIVA (não mais "todas as campanhas do banco" cegamente) — org
 * suspensa/cancelada não dispara touches nem busca de leads (gate mínimo de billing). 1 lock global (não
 * por org: o volume não justifica ainda) + orçamento de tempo/envios COMPARTILHADO entre todas as orgs da
 * rodada; 1 `SchedulerRun` por org processada (mais 1 "meta" sem org para status "locked"/erro geral).
 */
export async function runTick(now: Date, overrides: Partial<TickDeps> = {}): Promise<TickSummary> {
  const deps: TickDeps = { ...defaultDeps(), ...overrides };
  const t0 = deps.clock();
  const counters: Record<string, number> = {};
  const inc = (k: string, n = 1) => void (counters[k] = (counters[k] ?? 0) + n);
  const summary = (s: Omit<TickSummary, "durationMs" | "counters">): TickSummary => ({ ...s, counters, durationMs: deps.clock() - t0 });

  let lock: Awaited<ReturnType<AcquireLock>> = null;
  try {
    lock = await deps.acquireLock();
  } catch (e) {
    return summary({ status: "error", runId: null, budget: null, error: sanitize(safeErrorForLog(e)) });
  }
  if (!lock) {
    inc("locked");
    const run = await prisma.schedulerRun.create({ data: { startedAt: now, finishedAt: now, status: "locked", counters: { locked: 1 } } }).catch(() => null);
    return summary({ status: "locked", skipped: "locked", runId: run?.id ?? null, budget: null });
  }

  let firstRunId: string | null = null;
  let budget: TickSummary["budget"] = null;
  let error: string | undefined;
  const state = { sends: 0, budget: null as TickSummary["budget"] };
  try {
    await prisma.schedulerRun.deleteMany({ where: { startedAt: { lt: new Date(now.getTime() - RUN_RETENTION_MS) } } }).catch(() => {});
    // SPEC-033: recalcula Organization.status ANTES de selecionar as orgs ativas da rodada — cobre a
    // expiração do grace period de `past_due` (7 dias, D-33-3), que é dependente do tempo, não de um evento.
    await syncOrgStatuses(now).catch((e) => console.error("[scheduler] sync de status de billing falhou:", safeErrorForLog(e)));
    // deps.campaignIds (testes/execução dirigida): resolve as orgs donas dessas campanhas em vez de varrer todas.
    const orgIds = deps.campaignIds
      ? [...new Set((await prisma.campaign.findMany({ where: { id: { in: deps.campaignIds } }, select: { orgId: true } })).map((c) => c.orgId))]
      : (await prisma.organization.findMany({ where: { status: "active" }, select: { id: true } })).map((o) => o.id);
    for (const orgId of orgIds) {
      if (state.budget) break; // orçamento de tempo/envios já esgotado nesta rodada
      const runId = (await prisma.schedulerRun.create({ data: { orgId, startedAt: now, status: "running" } })).id;
      firstRunId ??= runId;
      let orgError: string | undefined;
      try {
        await execute(now, deps, t0, inc, state, orgId);
      } catch (e) {
        orgError = sanitize(safeErrorForLog(e));
        error ??= orgError;
        console.error(`[scheduler] rodada da org ${orgId} falhou:`, orgError);
      }
      await prisma.schedulerRun
        .update({ where: { id: runId }, data: { finishedAt: new Date(), status: orgError ? "error" : "ok", counters: { ...counters, ...(state.budget ? { budget: state.budget } : {}) }, error: orgError ?? null } })
        .catch(() => {});
    }
    budget = state.budget;
  } catch (e) {
    error = sanitize(safeErrorForLog(e));
    console.error("[scheduler] rodada falhou:", error);
  } finally {
    await lock.release().catch((e) => console.error("[scheduler] falha ao liberar lock:", safeErrorForLog(e)));
  }
  // SPEC-023: alertas mobile (isolado; falha nunca derruba o tick)
  await sweepThrottled(new Date()).catch(() => {});
  // SPEC-039: e-mails de lembrete/aviso do fluxo de billing (trial acabando, past_due, suspensão automática,
  // aviso pré-expurgo) — isolado; falha nunca derruba o tick. Roda ANTES do expurgo para o aviso "15 dias antes"
  // não perder a janela na mesma rodada em que o expurgo já executaria (defensivo; datas não coincidem na prática).
  await sendBillingReminders(new Date()).catch((e) => console.error("[scheduler] lembretes de billing falharam:", safeErrorForLog(e)));
  // SPEC-047 (D-047-1): renovação PIX (AbacatePay) — no-op quando o provider ativo não é AbacatePay ou
  // nenhuma Subscription é pixManaged. Isolado; falha nunca derruba o tick. Roda antes do expurgo, mesma
  // ordem de sendBillingReminders (past_due marcado aqui já é visto pelo aviso auto_suspended no PRÓXIMO tick).
  await runPixRenewalJob(new Date()).catch((e) => console.error("[scheduler] renovação PIX (AbacatePay) falhou:", safeErrorForLog(e)));
  // SPEC-033 (D-33-4): expurgo/anonimização 90 dias após cancelamento (isolado; falha nunca derruba o tick)
  await purgeCanceledOrgs(new Date()).catch((e) => console.error("[scheduler] expurgo de billing falhou:", safeErrorForLog(e)));
  return summary({ status: error ? "error" : "ok", runId: firstRunId, budget, ...(error ? { error } : {}) });
}

async function execute(now: Date, deps: TickDeps, t0: number, inc: (k: string, n?: number) => void, state: { sends: number; budget: TickSummary["budget"] }, orgId: string): Promise<void> {
  const processedTouches = new Set<string>();
  const processedLeads = new Set<string>();
  const usedInstances = new Set<string>();
  const stepsCache = new Map<string, StepRow[]>();
  const scope: Prisma.CampaignWhereInput = { orgId, ...(deps.campaignIds ? { id: { in: deps.campaignIds } } : {}) };
  // SPEC-013: lead de seed nunca entra nas filas (a menos que ALLOW_SEED_SENDS=true). source pode ser null -> OR explícito.
  const notSeed: Prisma.LeadWhereInput = allowSeedSends() ? {} : { OR: [{ source: null }, { source: { not: "seed" } }] };

  const outOfBudget = (): boolean => {
    if (deps.clock() - t0 >= deps.config.timeBudgetMs) return (state.budget ??= "time"), true;
    if (state.sends >= deps.config.maxSends) return (state.budget ??= "sends"), true;
    return false;
  };
  const getSteps = async (sequenceId: string): Promise<StepRow[]> => {
    let s = stepsCache.get(sequenceId);
    if (!s) {
      s = await prisma.sequenceStep.findMany({ where: { sequenceId }, orderBy: { order: "asc" }, select: { id: true, day: true, channel: true, order: true, agentId: true, agentFallbackTemplate: true } });
      stepsCache.set(sequenceId, s);
    }
    return s;
  };

  /** Avança o lead 1 step (idempotente: só se ainda está naquele step). completed ao esgotar. */
  const advanceLead = async (leadId: string, stepIdx: number, steps: StepRow[]): Promise<void> => {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { sequenceStartedAt: true, currentStepOrder: true } });
    if (!lead || lead.currentStepOrder !== stepIdx) return;
    const next = steps[stepIdx + 1] ?? null;
    const start = lead.sequenceStartedAt ?? now;
    const r = await prisma.lead.updateMany({
      where: { id: leadId, currentStepOrder: stepIdx, sequenceStatus: "active" },
      data: { currentStepOrder: stepIdx + 1, nextTouchAt: computeNextTouchAt(start, next), sequenceStartedAt: start, ...(next ? {} : { sequenceStatus: "completed" as const }) },
    });
    if (r.count) inc(next ? "advanced" : "completed");
  };

  const endLead = async (leadId: string, status: EndStatus | "suppressed"): Promise<void> => {
    let to: EndStatus;
    if (status === "suppressed") {
      const l = await prisma.lead.findUnique({ where: { id: leadId }, select: { email: true, phone: true } });
      const reason = l ? await findSuppression(l, orgId) : null;
      to = reason && (reason.startsWith("opt_out") || reason === "possible_opt_out_confirmed") ? "opted_out" : "completed";
    } else to = status;
    const r = await prisma.lead.updateMany({ where: { id: leadId, sequenceStatus: { in: ["active", "not_started"] } }, data: { sequenceStatus: to, nextTouchAt: null } });
    if (r.count) inc(`ended_${to}`);
  };

  const moveStage = async (leadId: string, campaignId: string): Promise<void> => {
    const opp = await prisma.opportunity.findUnique({ where: { leadId_campaignId: { leadId, campaignId } }, select: { id: true, stage: true } });
    if (!opp) return;
    const sentCount = await prisma.touch.count({ where: { leadId, direction: "outbound", status: { in: [...SENT_LIKE] } } });
    const to = decideStage(opp.stage, sentCount);
    if (!to) return;
    for (let i = 0; i < 3; i++) {
      const out = await runMoveOpportunity({ opportunityId: opp.id, toStage: to, toIndex: 1_000_000, campaignId });
      if (out.status !== "conflict") return void inc(`stage_${to}`);
    }
    inc("stage_conflict");
  };

  /** Executa o canal do Touch respeitando orçamento e "1 WhatsApp por instância por rodada". null = não chamou. */
  const dispatch = async (touchId: string, channel: Channel, instanceId: string | null): Promise<ChannelResult | null> => {
    if (channel === "whatsapp" && instanceId && usedInstances.has(instanceId)) return void inc("instance_busy"), null;
    state.sends++;
    let r: ChannelResult;
    try {
      r = channel === "whatsapp" ? await deps.sendWhatsApp(touchId, now) : await deps.sendEmail(touchId, now);
    } catch (e) {
      inc("errors");
      console.error("[scheduler] canal lançou erro:", safeErrorForLog(e));
      return null;
    }
    if (channel === "whatsapp" && instanceId) {
      if (r.status === "sent" || (r.status === "deferred" && "reason" in r && INSTANCE_LEVEL_DEFER.has(r.reason))) usedInstances.add(instanceId);
    }
    return r;
  };

  const applyResult = async (p: { touchId: string; leadId: string; campaignId: string; stepIdx: number; steps: StepRow[] }, result: ChannelResult): Promise<void> => {
    inc(`result_${result.status}`);
    const touch = await prisma.touch.findUnique({ where: { id: p.touchId }, select: { status: true, error: true, attempts: true } });
    if (!touch) return;
    const d = decideAfterSend(result, { now, attempts: touch.attempts, needsReview: result.status === "failed" && (touch.error ?? "").startsWith(NEEDS_REVIEW_PREFIX) });
    switch (d.kind) {
      case "noop":
        if ((SENT_LIKE as readonly string[]).includes(touch.status) && p.stepIdx >= 0) await advanceLead(p.leadId, p.stepIdx, p.steps);
        return;
      case "defer":
        // O canal já gravou scheduled+nextAt; só corrige se devolveu instante <= agora (evita laço).
        if (result.status === "deferred" && d.nextAt.getTime() !== result.nextAt.getTime()) await prisma.touch.updateMany({ where: { id: p.touchId, status: "scheduled" }, data: { scheduledAt: d.nextAt } });
        inc(`deferred_${"reason" in result ? result.reason : "other"}`);
        return;
      case "end":
        if (result.status === "skipped") inc(`skipped_${result.reason}`);
        await endLead(p.leadId, d.status);
        return;
      case "retry":
        await prisma.touch.update({ where: { id: p.touchId }, data: { status: "scheduled", scheduledAt: d.at, attempts: d.attempts } });
        inc("retry_scheduled");
        return;
      case "advance":
        if (result.status === "skipped") inc(`skipped_${result.reason}`);
        if (result.status === "failed") {
          await prisma.touch.update({ where: { id: p.touchId }, data: { attempts: touch.attempts + 1 } });
          inc(d.outcome === "timeout_no_retry" ? "timeout_no_retry" : "failed_final");
        }
        if (p.stepIdx >= 0) await advanceLead(p.leadId, p.stepIdx, p.steps);
        if (d.outcome === "sent") await moveStage(p.leadId, p.campaignId);
        return;
    }
  };

  // 2. Saúde das instâncias (retomada automática/pausa por queda). Nunca derruba a rodada.
  try {
    await deps.evaluateHealth(now);
  } catch (e) {
    inc("health_errors");
    console.error("[scheduler] avaliação de saúde falhou:", safeErrorForLog(e));
  }

  // 2b. Fase 0 (autoStart): SOMENTE campanhas com autoStart=true e ativas iniciam leads not_started elegíveis (não seed, não suprimidos,
  // contato válido). Sem autoStart nada é iniciado sem ação humana (startSequence/startCampaignSequences).
  try {
    const autoCamps = await prisma.campaign.findMany({ where: { status: "active", autoStart: true, sequenceId: { not: null }, ...scope }, select: { id: true } });
    for (const c of autoCamps) {
      const sum = await classifyStartable(c.id, orgId, { limit: AUTO_START_LIMIT, onlyNotStarted: true });
      if (!sum?.eligibleIds.length) continue;
      const n = await activateLeads(sum.eligibleIds, now);
      if (n) {
        inc("auto_started", n);
        await writeSequenceAudit({ action: "auto_start", campaignId: c.id, count: n });
      }
    }
  } catch (e) {
    inc("errors");
    console.error("[scheduler] fase 0 (autoStart) falhou:", safeErrorForLog(e));
  }

  // 2c. Varredura de Touches órfãos em `sending` (crash durante o envio, SPEC-013 QA M3): parados há mais que SENDING_STALE_MS viram `failed` com o
  // marcador de revisão humana (a mensagem PODE ter saído: nunca reenvia sozinho) e o lead avança como no timeout, senão ficaria travado (`open_touch`).
  try {
    const cutoff = new Date(now.getTime() - SENDING_STALE_MS);
    const stale = await prisma.touch.findMany({
      where: { status: "sending", direction: "outbound", updatedAt: { lt: cutoff }, lead: { ...notSeed, campaign: scope } },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: SCAN_LIMIT,
      select: { id: true, leadId: true, stepId: true, whatsappInstanceId: true, step: { select: { sequenceId: true } }, lead: { select: { campaignId: true } } },
    });
    for (const t of stale) {
      const r = await prisma.touch.updateMany({
        where: { id: t.id, status: "sending", updatedAt: { lt: cutoff } },
        data: { status: "failed", error: `${NEEDS_REVIEW_PREFIX} (envio interrompido antes da confirmação). Verifique antes de reenviar.`, attempts: { increment: 1 } },
      });
      if (!r.count) continue;
      inc("staleSending");
      processedTouches.add(t.id);
      processedLeads.add(t.leadId);
      if (t.whatsappInstanceId) {
        await prisma.instanceAlert
          .create({ data: { instanceId: t.whatsappInstanceId, kind: "warning", message: "Um envio ficou sem confirmação (interrompido). Verifique a mensagem antes de reenviar." } })
          .catch(() => {});
      }
      if (t.step) {
        const steps = await getSteps(t.step.sequenceId);
        const stepIdx = steps.findIndex((s) => s.id === t.stepId);
        if (stepIdx >= 0) await advanceLead(t.leadId, stepIdx, steps);
      }
    }
  } catch (e) {
    inc("errors");
    console.error("[scheduler] varredura de sending falhou:", safeErrorForLog(e));
  }

  // 3. Fila A: Touches scheduled vencidos (adiados pelos canais, retries).
  const due = await prisma.touch.findMany({
    where: { status: "scheduled", direction: "outbound", channel: { in: ["email", "whatsapp"] }, scheduledAt: { lte: now }, lead: { ...notSeed, campaign: { status: "active", ...scope } } },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    take: SCAN_LIMIT,
    select: {
      id: true, channel: true, stepId: true, leadId: true,
      step: { select: { sequenceId: true } },
      lead: { select: { campaignId: true, campaign: { select: { whatsappInstanceId: true } } } },
    },
  });
  for (const t of due) {
    if (outOfBudget()) break;
    if (processedTouches.has(t.id)) continue;
    processedTouches.add(t.id);
    const r = await dispatch(t.id, t.channel, t.lead.campaign.whatsappInstanceId);
    if (!r) continue;
    processedLeads.add(t.leadId);
    inc("processed_a");
    // SPEC-019: envio de agente que foi adiado e saiu agora => draft vira "sent" e o lead avanca (estava estacionado).
    if (r.status === "sent") {
      const dr = await prisma.draft.findFirst({ where: { touchId: t.id, status: { in: ["approved", "edited"] } }, select: { id: true } });
      if (dr) {
        await prisma.draft.update({ where: { id: dr.id }, data: { status: "sent" } });
        await advanceAfterAgentStep(t.leadId, t.stepId, now);
      }
    }
    const steps = t.step ? await getSteps(t.step.sequenceId) : [];
    try {
      await applyResult({ touchId: t.id, leadId: t.leadId, campaignId: t.lead.campaignId, stepIdx: steps.findIndex((s) => s.id === t.stepId), steps }, r);
    } catch (e) {
      inc("errors");
      console.error("[scheduler] falha ao aplicar resultado:", safeErrorForLog(e));
    }
  }

  // 4. Fila B: leads devidos.
  if (!outOfBudget()) {
    const rows = await prisma.lead.findMany({
      where: {
        sequenceStatus: "active", nextTouchAt: { lte: now },
        ...notSeed,
        optedOutAt: null, repliedAt: null,
        campaign: { status: "active", sequenceId: { not: null }, ...scope },
      },
      orderBy: [{ nextTouchAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }, { id: "asc" }],
      take: SCAN_LIMIT,
      select: {
        id: true, campaignId: true, sequenceStatus: true, nextTouchAt: true, optedOutAt: true, repliedAt: true, createdAt: true, currentStepOrder: true, sequenceStartedAt: true, email: true, phone: true,
        campaign: { select: { status: true, sequenceId: true, whatsappInstanceId: true } },
      },
    });
    const leads = pickDueLeads(rows.map((r) => ({ ...r, campaignStatus: r.campaign.status, hasSequence: !!r.campaign.sequenceId })), now);
    for (const lead of leads) {
      if (outOfBudget()) break;
      if (processedLeads.has(lead.id)) continue;
      processedLeads.add(lead.id);
      try {
        const steps = await getSteps(lead.campaign.sequenceId!);
        const idx = lead.currentStepOrder;
        const step = steps[idx];
        if (!step) {
          await prisma.lead.updateMany({ where: { id: lead.id, sequenceStatus: { in: ["active", "not_started"] } }, data: { sequenceStatus: "completed", nextTouchAt: null } });
          inc("completed");
          continue;
        }
        if (await findSuppression({ email: lead.email, phone: lead.phone }, orgId)) {
          await endLead(lead.id, "suppressed");
          inc("suppressed_closed");
          continue;
        }
        const existing = await prisma.touch.findUnique({ where: { leadId_stepId: { leadId: lead.id, stepId: step.id } }, select: { id: true, status: true } });
        if (existing) {
          if (["scheduled", "pending", "sending"].includes(existing.status)) { inc("open_touch"); continue; } // dono: Fila A
          inc("recovered");
          await advanceLead(lead.id, idx, steps);
          if ((SENT_LIKE as readonly string[]).includes(existing.status)) await moveStage(lead.id, lead.campaignId);
          continue;
        }
        // SPEC-019: passo de agente. Agente disponível => enfileira a tarefa (sem LLM aqui) e estaciona o lead até o rascunho ser tratado.
        // Indisponível (desligado/kill switch/sem teto): usa o template só se o passo tem fallback; senão aguarda (nada é enviado).
        if (step.agentId) {
          if (await isAgentAvailable(step.agentId)) {
            const start = lead.sequenceStartedAt ?? now;
            await prisma.lead.updateMany({ where: { id: lead.id, sequenceStatus: { in: ["active", "not_started"] } }, data: { sequenceStatus: "active", sequenceStartedAt: start, nextTouchAt: null } });
            inc((await enqueueAgentRun({ agentId: step.agentId, leadId: lead.id, stepId: step.id, trigger: "step" })) ? "agent_enqueued" : "agent_already_enqueued");
            continue;
          }
          if (!step.agentFallbackTemplate) { inc("agent_unavailable"); continue; }
          inc("agent_fallback_template");
        }
        const instanceId = lead.campaign.whatsappInstanceId;
        if (step.channel === "whatsapp" && instanceId && usedInstances.has(instanceId)) { inc("instance_busy"); continue; }

        // O 1º toque define o início da sequência.
        const start = lead.sequenceStartedAt ?? now;
        await prisma.lead.updateMany({ where: { id: lead.id, sequenceStatus: { in: ["active", "not_started"] } }, data: { sequenceStatus: "active", sequenceStartedAt: start } });
        let touchId: string;
        try {
          const status = step.channel === "email" || step.channel === "whatsapp" ? "scheduled" : "skipped";
          touchId = (await prisma.touch.create({
            data: { leadId: lead.id, stepId: step.id, channel: step.channel, status, scheduledAt: now, ...(status === "skipped" ? { error: "canal manual (sem envio automático)" } : {}) },
            select: { id: true },
          })).id;
          if (status === "skipped") {
            inc("unsupported_channel");
            await advanceLead(lead.id, idx, steps);
            continue;
          }
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") { inc("touch_conflict"); continue; }
          throw e;
        }
        processedTouches.add(touchId);
        const r = await dispatch(touchId, step.channel, instanceId);
        if (!r) continue;
        inc("processed_b");
        await applyResult({ touchId, leadId: lead.id, campaignId: lead.campaignId, stepIdx: idx, steps }, r);
      } catch (e) {
        inc("errors");
        console.error("[scheduler] falha ao processar lead:", safeErrorForLog(e));
      }
    }
  }
}
