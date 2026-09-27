import { prisma } from "@/lib/prisma";
import { tooManyRequests } from "@/lib/http";
import { safeErrorForLog } from "@/lib/errors";
import { normalizeBrPhone } from "@/lib/domain/phone";
import { createMeeting, writeMeetingAudit } from "@/lib/domain/meeting";
import { bearerToken, secretsMatch } from "@/lib/scheduler/cron-endpoint";
import { getIngestSecret, isIngestEnabled } from "@/lib/lead-ingest/config";
import { readBodyLimited } from "@/lib/lead-ingest/handler";
import { meetingWebhookSchema } from "@/lib/schemas/meeting";

/**
 * POST /api/integrations/meetings (SPEC-028). MESMO padrao de auth das integracoes (SPEC-014/018): Bearer INGEST_SECRET,
 * desligado (503) sem INTEGRATION_LEADS_ENABLED=true. Nunca ecoa corpo/segredo; erros so com codigo e mensagem fixa.
 * Idempotente por `externalId` (prefixo "wh:", escopado por org — ver `scopedExternalId` em
 * `src/lib/domain/meeting.ts`): repeticao devolve a mesma reuniao (200, idempotentReplay), NUNCA a reuniao
 * de outra org com o mesmo `externalId` cru.
 *
 * SPEC-030 (fix de vazamento cross-tenant, 2026-09-26): `campaignId` (obrigatorio no payload, ver
 * `meetingWebhookSchema`) e quem resolve a organizacao ANTES de qualquer busca de lead — mesmo padrao de
 * `/api/integrations/leads`. `leadId`/`phone` sao sempre resolvidos ESCOPADOS a esse `campaignId` (nunca uma
 * busca global), e `createMeeting()` recebe `orgId` explicito para a defesa em profundidade em
 * `src/lib/domain/meeting.ts` (`opp.campaign.orgId === p.orgId`). Antes desta rodada, o segredo global
 * (`INGEST_SECRET`) combinado com busca de lead sem escopo de org permitia criar reuniao na organizacao
 * errada (telefone/leadId adivinhado de outro tenant).
 *
 * SPEC-030 (fix de vazamento cross-tenant #2, Rodada 5, achado do QA): mesmo com `campaignId` obrigatorio
 * acima, a checagem de IDEMPOTENCIA por `externalId` ainda comparava contra a tabela `Meeting` inteira, sem
 * filtro de org (`Meeting.externalId` e `@unique` GLOBALMENTE no schema) — uma org B podia reaproveitar um
 * `externalId` ja usado pela org A e receber de volta a reuniao da A como "replay". Corrigido em
 * `createMeeting()`/`scopedExternalId()` (`src/lib/domain/meeting.ts`), nao neste arquivo.
 */
const MAX_BODY = 16 * 1024;
const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (body: unknown, status: number, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
const err = (status: number, error: string, message: string, extra: Record<string, string> = {}) => json({ error, message }, status, extra);

export const unauthorized = () => err(401, "unauthorized", "Não autorizado.", { "WWW-Authenticate": "Bearer" });
export const methodNotAllowed = () => err(405, "method_not_allowed", "Método não permitido.", { Allow: "POST" });

const INVALID = { windowMs: 60_000, max: 20 };
const VALID = { windowMs: 60_000, max: 300 };
type Bucket = { count: number; resetAt: number };
let invalidBucket: Bucket = { count: 0, resetAt: 0 };
let validBucket: Bucket = { count: 0, resetAt: 0 };
export const _resetMeetingWebhookRateLimit = (): void => {
  invalidBucket = { count: 0, resetAt: 0 };
  validBucket = { count: 0, resetAt: 0 };
};
function hit(b: Bucket, cfg: { windowMs: number; max: number }): { b: Bucket; wait: number | null } {
  const now = Date.now();
  if (b.resetAt <= now) b = { count: 0, resetAt: now + cfg.windowMs };
  b.count++;
  return { b, wait: b.count > cfg.max ? Math.max(1, Math.ceil((b.resetAt - now) / 1000)) : null };
}

export interface MeetingWebhookDeps { secret?: string | null; enabled?: boolean; now?: Date }

export async function handleMeetingWebhook(req: Request, deps: MeetingWebhookDeps = {}): Promise<Response> {
  const secret = deps.secret !== undefined ? deps.secret : getIngestSecret();
  const enabled = deps.enabled !== undefined ? deps.enabled : isIngestEnabled();
  if (!enabled || !secret) return err(503, "not_configured", "Integração desativada ou não configurada.");

  const token = bearerToken(req);
  if (!token || !secretsMatch(token, secret)) {
    const r = hit(invalidBucket, INVALID);
    invalidBucket = r.b;
    return r.wait !== null ? tooManyRequests(r.wait) : unauthorized();
  }
  const v = hit(validBucket, VALID);
  validBucket = v.b;
  if (v.wait !== null) return tooManyRequests(v.wait);

  try {
    const raw = await readBodyLimited(req, MAX_BODY);
    if (raw === null) return err(413, "payload_too_large", "Corpo excede o limite.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return err(400, "invalid_json", "JSON inválido.");
    }
    const p = meetingWebhookSchema.safeParse(parsed);
    if (!p.success) return json({ error: "validation_error", message: "Payload inválido.", details: [...new Set(p.error.issues.map((i) => i.message))] }, 400);
    const d = p.data;

    const campaign = await prisma.campaign.findUnique({ where: { id: d.campaignId }, select: { orgId: true } });
    if (!campaign) return err(404, "campaign_not_found", "Campanha não encontrada.");

    let leadId = d.leadId;
    if (!leadId) {
      const ph = normalizeBrPhone(d.phone!);
      if (!ph.ok) return json({ error: "validation_error", message: "Payload inválido.", details: ["Telefone inválido."] }, 400);
      // Escopado por campaignId (nunca busca global): telefone repetido em outro tenant nunca colide aqui.
      const leads = await prisma.lead.findMany({ where: { campaignId: d.campaignId, phone: { in: [ph.e164, ph.e164.slice(1)] } }, select: { id: true }, take: 2 });
      if (leads.length > 1) return err(409, "ambiguous_lead", "Mais de um lead com este telefone: informe leadId.");
      leadId = leads[0]?.id;
    }
    // findFirst com campaignId explícito (não findUnique por id): leadId de outra campanha/org nunca resolve aqui.
    const lead = leadId ? await prisma.lead.findFirst({ where: { id: leadId, campaignId: d.campaignId }, select: { id: true, campaignId: true } }) : null;
    if (!lead) return err(404, "lead_not_found", "Lead não encontrado.");
    const opp = await prisma.opportunity.findUnique({ where: { leadId_campaignId: { leadId: lead.id, campaignId: lead.campaignId } }, select: { id: true } });
    if (!opp) return err(404, "opportunity_not_found", "Lead sem oportunidade.");

    const r = await createMeeting({
      opportunityId: opp.id, startsAt: d.startsAt, durationMin: d.durationMin ?? 30, link: d.link ?? null, source: "webhook",
      externalId: d.externalId ? `wh:${d.externalId}` : null, now: deps.now,
      orgId: campaign.orgId,
    });
    if (r.status === "invalid") return json({ error: "validation_error", message: "Payload inválido.", details: [r.message] }, 400);
    if (r.status === "not_found") return err(404, "opportunity_not_found", "Lead sem oportunidade.");
    if (r.status === "conflict") return err(409, "conflict", "Conflito ao salvar, tente novamente.", { "Retry-After": "1" });
    if (!r.replay) await writeMeetingAudit("created", { meetingId: r.meeting.id, source: "webhook" });
    return json(
      { meetingId: r.meeting.id, leadId: lead.id, startsAt: r.meeting.startsAt.toISOString(), endsAt: r.meeting.endsAt.toISOString(), conflicts: r.conflicts.length, ...(r.replay ? { idempotentReplay: true } : {}) },
      r.replay ? 200 : 201,
    );
  } catch (e) {
    console.error("[integrations/meetings] erro:", safeErrorForLog(e));
    return err(500, "internal", "Falha ao processar. Tente novamente.");
  }
}
