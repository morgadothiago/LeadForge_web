import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError, safeErrorForLog } from "@/lib/errors";
import { findIntegrationConfig } from "@/lib/integrations/config";
import { processItem } from "@/lib/lead-ingest/handler";
import { startOfLocalDay } from "@/lib/whatsapp/send-window";
import { dailyRequestBudget, isSearchEnabled, maxCampaignsPerTick, maxResultsPerRun, tickDeadlineMs } from "./config";
import { createPlacesClient, PlacesSource } from "./places";
import { scoreLead } from "./score";
import type { LeadSource } from "./types";

export const SEARCH_LEGAL_BASIS = "interesse_legitimo_b2b";

export interface SearchOutcome {
  runId: string;
  found: number;
  created: number;
  duplicate: number;
  suppressed: number;
  invalid: number;
  requests: number;
}

export const SEARCH_TZ = "America/Sao_Paulo";
const startOfDay = (d = new Date()) => startOfLocalDay(SEARCH_TZ, d);
const lockKey = (campaignId: string) => `leadsearch:${campaignId}`;

type Reservation = { runId: string } | { blocked: string } | { skipped: true };

/**
 * Reserva atômica: lock advisory por campanha (transacional) em torno de check+create. Só uma execução passa por vez;
 * a reserva ("running", requests 0) conta como 1 chamada para as concorrentes. `blocked` só é gravado no trigger manual e não conta orçamento.
 */
async function reserve(campaignId: string, sourceId: string, trigger: "manual" | "scheduled", block: string | null): Promise<Reservation> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(campaignId)}))`;
    const since = startOfDay();
    let reason = block;
    if (!reason) {
      if (trigger === "scheduled") {
        // Uma execução agendada por campanha por dia (o tick roda a cada minuto; falha também conta, sem retry em laço).
        const already = await tx.searchRun.count({ where: { campaignId, trigger: "scheduled", status: { not: "blocked" }, startedAt: { gte: since } } });
        if (already > 0) return { skipped: true as const };
      }
      // UMA leitura só (mesmo snapshot): duas consultas separadas poderiam ver o run "running" na 1ª e "done" na 2ª e contar 0.
      const today = await tx.searchRun.findMany({ where: { campaignId, startedAt: { gte: since } }, select: { status: true, requests: true } });
      const spent = today.reduce((n, r) => n + (r.status === "running" ? Math.max(r.requests, 1) : r.requests), 0);
      if (spent >= dailyRequestBudget()) reason = "Limite diário de buscas desta campanha atingido. Tente amanhã.";
    }
    if (reason) {
      if (trigger === "manual") {
        await tx.searchRun.create({ data: { campaignId, source: sourceId, trigger, status: "blocked", error: reason, finishedAt: new Date() } });
      }
      return { blocked: reason };
    }
    const run = await tx.searchRun.create({ data: { campaignId, source: sourceId, trigger }, select: { id: true } });
    return { runId: run.id };
  });
}

const cfgErr = (m: string) => new AppError({ code: "config", userMessage: m });
const DISABLED = "Busca de leads desativada. Ative LEAD_SEARCH_ENABLED e cadastre a chave de Places.";
const NO_KEY = "Chave de Places não configurada. Cadastre em Configurações > Integrações.";

async function execute(campaignId: string, opts: { trigger?: "manual" | "scheduled"; source?: LeadSource }): Promise<SearchOutcome | "skipped"> {
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

  const r = await reserve(campaignId, source?.id ?? "google_places", trigger, block);
  if ("skipped" in r) return "skipped";
  if ("blocked" in r) throw new AppError({ code: block ? "config" : "rate_limited", userMessage: r.blocked });
  if (!source) throw cfgErr(NO_KEY);

  const run = { id: r.runId };
  const out: SearchOutcome = { runId: run.id, found: 0, created: 0, duplicate: 0, suppressed: 0, invalid: 0, requests: 0 };
  const counters = () => ({ requests: out.requests, found: out.found, created: out.created, duplicate: out.duplicate, suppressed: out.suppressed, invalid: out.invalid });
  try {
    const { leads, requests } = await source.search(camp.icp, maxResultsPerRun());
    out.requests = requests;
    out.found = leads.length;
    for (const [i, l] of leads.entries()) {
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
        else out.invalid++;
      } catch (e) {
        console.error("[lead-search] item:", safeErrorForLog(e));
        out.invalid++;
      }
    }
    await prisma.searchRun.update({ where: { id: run.id }, data: { status: "done", ...counters(), finishedAt: new Date() } });
    return out;
  } catch (e) {
    console.error("[lead-search] falha:", safeErrorForLog(e));
    const msg = e instanceof AppError ? e.userMessage : "Falha inesperada na busca.";
    await prisma.searchRun.update({ where: { id: run.id }, data: { status: "failed", ...counters(), requests: Math.max(out.requests, 1), error: msg, finishedAt: new Date() } }).catch(() => undefined);
    throw e;
  }
}

/** Executa a busca para UMA campanha. Lança AppError PT-BR se desligada/sem chave/sem orçamento (manual grava run "blocked"). Nunca loga PII. */
export async function runLeadSearch(campaignId: string, opts: { trigger?: "manual" | "scheduled"; source?: LeadSource } = {}): Promise<SearchOutcome> {
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
      if (o === "skipped") continue;
      ran++;
      res.push({ campaignId: c.id, ok: true, created: o.created });
    } catch (e) {
      ran++;
      res.push({ campaignId: c.id, ok: false, error: e instanceof AppError ? e.userMessage : "erro" });
    }
  }
  return res;
}
