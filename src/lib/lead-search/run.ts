import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError, safeErrorForLog } from "@/lib/errors";
import { findIntegrationConfig } from "@/lib/integrations/config";
import { getEntitlements } from "@/lib/billing/entitlements";
import { PlanLimitError } from "@/lib/billing/limit-error";
import { processItem } from "@/lib/lead-ingest/handler";
import { startOfLocalDay } from "@/lib/whatsapp/send-window";
import { computeBudget } from "./budget";
import { dailyRequestBudget, isSearchEnabled, manualDailyBudget, maxCampaignsPerTick, maxResultsPerRun, orgDailyBudget, STALE_RUN_MS, tickDeadlineMs } from "./config";
import { createPlacesClient, PlacesSource } from "./places";
import { scoreLead } from "./score";
import type { LeadSource, SearchCursor } from "./types";

/** SPEC-065: motivo gravado em `SearchRun.error` (run `done` parcial) quando a cota de leads do plano acaba. */
export const PLAN_LIMIT_RUN_MESSAGE = "Limite de leads do plano atingido. Faça upgrade para continuar trazendo leads.";
export const SEARCH_LEGAL_BASIS = "interesse_legitimo_b2b";

export interface SearchOutcome {
  runId: string;
  found: number;
  created: number;
  duplicate: number;
  suppressed: number;
  invalid: number;
  requests: number;
  /** SPEC-065 (D-065-18): a cota de leads do plano acabou no meio do lote — resultado PARCIAL (nao e erro); `SearchRun.error` explica. */
  limitReached?: boolean;
}

export const SEARCH_TZ = "America/Sao_Paulo";
const startOfDay = (d = new Date()) => startOfLocalDay(SEARCH_TZ, d);
const lockKey = (campaignId: string) => `leadsearch:${campaignId}`;
const orgLockKey = (orgId: string) => `leadsearch:org:${orgId}`;

type Reservation = { runId: string; maxRequests: number } | { blocked: string } | { skipped: true } | { inProgress: string } | { busy: string };

export const BUSY_MESSAGE = "Já existe uma busca em andamento para esta campanha.";
const STALE_MESSAGE = "Execução interrompida.";

/**
 * Reserva atômica: lock advisory por campanha (transacional) em torno de check+create. Só uma execução passa por vez;
 * a reserva ("running", requests 0) conta como 1 chamada para as concorrentes. `blocked` só é gravado no trigger manual e não conta orçamento.
 * SPEC-058 (D-058-3): (1) run `running` preso > STALE vira `failed` cobrando 1 chamada; (2) "uma busca por campanha por vez":
 * diária que encontra run `running` pula; manual que encontra manual `running` recebe o runId em andamento (idempotência de duplo clique);
 * manual que encontra diária `running` é recusada. (3) D-058-2: o manual tem teto próprio por campanha e por org (manual+diária); a diária
 * só conta runs agendadas. A contagem vem de `budget.ts` (a mesma do painel).
 */
async function reserve(campaignId: string, orgId: string, sourceId: string, trigger: "manual" | "scheduled", block: string | null): Promise<Reservation> {
  return prisma.$transaction(async (tx) => {
    // Ordem fixa (org ANTES da campanha) evita deadlock; o lock da org serializa o teto da org entre campanhas diferentes (só o manual consulta esse teto).
    if (trigger === "manual") await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgLockKey(orgId)}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(campaignId)}))`;
    const since = startOfDay();
    let reason = block;
    let maxRequests = 1;
    if (!reason) {
      await tx.searchRun.updateMany({
        where: { campaignId, status: "running", startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
        data: { status: "failed", requests: 1, error: STALE_MESSAGE, finishedAt: new Date() },
      });
      const active = await tx.searchRun.findFirst({ where: { campaignId, status: "running" }, select: { id: true, trigger: true }, orderBy: { startedAt: "desc" } });
      if (active) {
        if (trigger === "scheduled") return { skipped: true as const };
        if (active.trigger === "manual") return { inProgress: active.id };
        return { busy: BUSY_MESSAGE };
      }
      // SPEC-069b: `maxLeadSearchesPerDay` do plano (Free 2 / Starter 10 / Pro 30; 0 = sem busca; null = ilimitado), contado por ORG no dia (manual + agendada, sem
      // runs `blocked`). A agendada so PULA (silencioso); a manual recebe `plan_limit`. Plano ilegivel/org bloqueada => limite 0 (fail-closed).
      const searchCap = (await getEntitlements(tx, orgId)).limits.maxLeadSearchesPerDay;
      if (searchCap !== null) {
        const usedToday = await tx.searchRun.count({ where: { campaign: { orgId }, startedAt: { gte: since }, status: { not: "blocked" } } });
        if (usedToday >= searchCap) {
          if (trigger === "scheduled") return { skipped: true as const };
          throw new PlanLimitError("lead_searches", searchCap, usedToday);
        }
      }
      if (trigger === "scheduled") {
        // Uma execução agendada por campanha por dia (o tick roda a cada minuto; falha também conta, sem retry em laço).
        const already = await tx.searchRun.count({ where: { campaignId, trigger: "scheduled", status: { not: "blocked" }, startedAt: { gte: since } } });
        if (already > 0) return { skipped: true as const };
      }
      // UMA leitura só (mesmo snapshot): duas consultas separadas poderiam ver o run "running" na 1ª e "done" na 2ª e contar 0.
      const today = await tx.searchRun.findMany({ where: { campaignId, startedAt: { gte: since } }, select: { trigger: true, status: true, requests: true } });
      const orgToday = trigger === "manual" ? await tx.searchRun.findMany({ where: { campaign: { orgId }, startedAt: { gte: since } }, select: { trigger: true, status: true, requests: true } }) : [];
      const b = computeBudget(today, orgToday, { daily: dailyRequestBudget(), manual: manualDailyBudget(), org: orgDailyBudget() });
      if (trigger === "scheduled") {
        if (b.scheduledUsed >= dailyRequestBudget()) reason = "Limite diário de buscas desta campanha atingido. Tente amanhã.";
        else maxRequests = dailyRequestBudget() - b.scheduledUsed;
      } else if (b.remainingManual <= 0) reason = "Limite diário de buscas manuais desta campanha atingido. Tente amanhã.";
      else if (b.remainingOrg <= 0) reason = "Limite diário de buscas da organização atingido. Tente amanhã.";
      else maxRequests = b.estimatedPaidCallsLeft;
    }
    if (reason) {
      if (trigger === "manual") {
        await tx.searchRun.create({ data: { campaignId, source: sourceId, trigger, status: "blocked", error: reason, finishedAt: new Date() } });
      }
      return { blocked: reason };
    }
    const run = await tx.searchRun.create({ data: { campaignId, source: sourceId, trigger }, select: { id: true } });
    // SPEC-060: chamadas que esta busca pode fazer sem estourar o teto (máx. 2: página + fallback de token inválido).
    return { runId: run.id, maxRequests: Math.min(Math.max(maxRequests, 1), 2) };
  });
}

const cfgErr = (m: string) => new AppError({ code: "config", userMessage: m });
const DISABLED = "Busca de leads indisponível no momento, fale com o suporte.";
const TIMEOUT_MESSAGE = "A busca excedeu o tempo limite. Tente novamente em instantes.";
const NO_KEY = "Chave de Places não configurada. Cadastre em Configurações > Integrações.";

async function execute(campaignId: string, opts: { trigger?: "manual" | "scheduled"; source?: LeadSource; timeoutMs?: number }): Promise<SearchOutcome | "skipped" | { inProgress: string }> {
  const trigger = opts.trigger ?? "manual";
  const camp = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true, orgId: true, status: true, icp: { select: { niche: true, location: true, keywords: true } } } });
  if (!camp) throw new AppError({ code: "not_found", userMessage: "Campanha não encontrada." });
  if (camp.status !== "active") throw new AppError({ code: "conflict", userMessage: "A campanha precisa estar ativa para buscar leads." });

  let source = opts.source;
  let block: string | null = null;
  if (!isSearchEnabled()) block = DISABLED;
  else if (!source) {
    const cfg = await findIntegrationConfig(camp.orgId, "places");
    if (!cfg) block = NO_KEY;
    else source = new PlacesSource(createPlacesClient(cfg.reveal()));
  }
  if (block && trigger === "scheduled") return "skipped"; // agendado sem chave/desligado: silencioso (a UI mostra o estado)

  const r = await reserve(campaignId, camp.orgId, source?.id ?? "google_places", trigger, block);
  if ("skipped" in r) return "skipped";
  if ("inProgress" in r) return r;
  if ("busy" in r) throw new AppError({ code: "conflict", userMessage: r.busy });
  if ("blocked" in r) throw new AppError({ code: block ? "config" : "rate_limited", userMessage: r.blocked });
  if (!source) throw cfgErr(NO_KEY);

  const run = { id: r.runId };
  const out: SearchOutcome = { runId: run.id, found: 0, created: 0, duplicate: 0, suppressed: 0, invalid: 0, requests: 0 };
  let nextCursor: SearchCursor | null = null;
  const progress = { requests: 0 }; // chamadas pagas feitas pela fonte (visível ao catch se search lançar após 2 chamadas)
  const counters = () => ({ requests: out.requests, found: out.found, created: out.created, duplicate: out.duplicate, suppressed: out.suppressed, invalid: out.invalid });
  // SPEC-058 (D-058-4): prazo total da busca síncrona; estourar vira run `failed` (a corrida garante o fim mesmo se a fonte ignorar o signal).
  const ctrl = new AbortController();
  const timer = opts.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : undefined;
  const timeoutErr = () => new AppError({ code: "timeout", userMessage: TIMEOUT_MESSAGE, retryable: true });
  const aborted = new Promise<never>((_, rej) => ctrl.signal.addEventListener("abort", () => rej(timeoutErr()), { once: true }));
  aborted.catch(() => undefined);
  try {
    // SPEC-060: continua de onde a última busca concluída parou (cursor persistido em SearchRun).
    const prev = await prisma.searchRun.findFirst({ where: { campaignId, status: "done", searchQuery: { not: null } }, orderBy: { startedAt: "desc" }, select: { variant: true, pageToken: true, searchQuery: true } });
    const sopts = { cursor: prev?.searchQuery ? { variant: prev.variant, pageToken: prev.pageToken, query: prev.searchQuery } : null, maxRequests: r.maxRequests, progress };
    const found = opts.timeoutMs ? Promise.race([source.search(camp.icp, maxResultsPerRun(), ctrl.signal, sopts), aborted]) : source.search(camp.icp, maxResultsPerRun(), undefined, sopts);
    const { leads, requests, cursor } = await found;
    nextCursor = cursor ?? null;
    out.requests = requests;
    out.found = leads.length;
    let limitReached = false;
    for (const [i, l] of leads.entries()) {
      if (ctrl.signal.aborted) throw timeoutErr();
      try {
        // Dedupe por externalId do Places (intra-campanha), além de telefone/e-mail do processItem.
        if (l.externalId) {
          const same = await prisma.lead.findFirst({ where: { campaignId, rawData: { path: ["externalId"], equals: l.externalId } }, select: { id: true } });
          if (same) { out.duplicate++; continue; }
        }
        const res = await processItem(
          campaignId,
          { name: l.name, company: l.company, email: l.email, phone: l.phone, website: l.website, source: source.id, externalId: l.externalId },
          i,
        );
        if (res.status === "created" && res.leadId) {
          out.created++;
          // O lead já existe: falha ao gravar score/rawData é registrada e não derruba o lote.
          await prisma.lead
            .update({
              where: { id: res.leadId },
              data: {
                score: scoreLead(l),
                rawData: { externalId: l.externalId, source: source.id, legalBasis: SEARCH_LEGAL_BASIS, address: l.address, rating: l.rating, ratingCount: l.ratingCount, searchRunId: run.id } as Prisma.InputJsonValue,
              },
            })
            .catch((e) => console.error("[lead-search] score/rawData:", safeErrorForLog(e)));
        } else if (res.status === "duplicate") out.duplicate++;
        else if (res.status === "suppressed") out.suppressed++;
        else if (res.status === "limit_reached") {
          limitReached = true;
          break; // cria ate a cota e PARA (D-065-18)
        } else out.invalid++;
      } catch (e) {
        console.error("[lead-search] item:", safeErrorForLog(e));
        out.invalid++;
      }
    }
    // Limite do plano: NAO avanca o cursor (a proxima busca, depois do upgrade, retoma esta pagina) e registra o motivo no run.
    if (limitReached) {
      out.limitReached = true;
      await prisma.searchRun.update({ where: { id: run.id }, data: { status: "done", ...counters(), error: PLAN_LIMIT_RUN_MESSAGE, finishedAt: new Date() } });
      return out;
    }
    await prisma.searchRun.update({ where: { id: run.id }, data: { status: "done", ...counters(), ...(nextCursor ? { variant: nextCursor.variant, pageToken: nextCursor.pageToken, searchQuery: nextCursor.query } : {}), finishedAt: new Date() } });
    return out;
  } catch (e) {
    console.error("[lead-search] falha:", safeErrorForLog(e));
    const msg = e instanceof AppError ? e.userMessage : "Falha inesperada na busca.";
    await prisma.searchRun.update({ where: { id: run.id }, data: { status: "failed", ...counters(), requests: Math.max(out.requests, progress.requests, 1), error: msg, finishedAt: new Date() } }).catch(() => undefined);
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Executa a busca para UMA campanha. Lança AppError PT-BR se desligada/sem chave/sem orçamento (manual grava run "blocked"). Nunca loga PII. */
export async function runLeadSearch(campaignId: string, opts: { trigger?: "manual" | "scheduled"; source?: LeadSource; timeoutMs?: number } = {}): Promise<SearchOutcome> {
  const r = await startLeadSearch(campaignId, opts);
  if ("inProgress" in r) throw new AppError({ code: "conflict", userMessage: BUSY_MESSAGE });
  return r;
}

/** SPEC-058: como `runLeadSearch`, mas devolve `{ inProgress: runId }` (sem executar nem cobrar) se já há busca MANUAL em andamento na campanha (duplo clique/retry). */
export async function startLeadSearch(campaignId: string, opts: { trigger?: "manual" | "scheduled"; source?: LeadSource; timeoutMs?: number } = {}): Promise<SearchOutcome | { inProgress: string }> {
  const r = await execute(campaignId, opts);
  if (r === "skipped") throw new AppError({ code: "conflict", userMessage: "Já houve uma execução agendada hoje para esta campanha." });
  return r;
}

/** Job diário: roda campanhas ativas (falha de uma não derruba as outras), com teto por tick e deadline; sobras ficam para o próximo tick. */
export async function runDailySearch(opts: { now?: () => number; source?: LeadSource } = {}): Promise<{ campaignId: string; ok: boolean; created?: number; error?: string }[]> {
  if (!isSearchEnabled()) return [];
  const now = opts.now ?? Date.now;
  const deadline = now() + tickDeadlineMs();
  const max = maxCampaignsPerTick();
  const camps = await prisma.campaign.findMany({ where: { status: "active" }, select: { id: true }, orderBy: { id: "asc" } });
  const res: { campaignId: string; ok: boolean; created?: number; error?: string }[] = [];
  let ran = 0;
  for (const c of camps) {
    if (ran >= max || now() >= deadline) break;
    try {
      const o = await execute(c.id, { trigger: "scheduled", source: opts.source });
      if (o === "skipped" || "inProgress" in o) continue;
      ran++;
      res.push({ campaignId: c.id, ok: true, created: o.created });
    } catch (e) {
      ran++;
      res.push({ campaignId: c.id, ok: false, error: e instanceof AppError ? e.userMessage : "erro" });
    }
  }
  return res;
}
