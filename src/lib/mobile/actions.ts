import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { verifyPassword } from "@/lib/auth/password";
import { dispatchDraft, rejectDraft } from "@/lib/agents/drafts";
import { stopAgentOnManualReply } from "@/lib/agents/lead-state";
import { fail, invalidInput, ok, requireMobile, tooMany, type MobileAuth } from "./http";
import { hitActionLimit, clearReauthFailures, recordReauthFailure, reauthBlockedSeconds } from "./action-limit";
import { resolveOrgId } from "./org";

export { resolveOrgId };

/**
 * SPEC-026: acoes de gestao leves do app. As regras vivem nas funcoes de dominio ja usadas pelo web
 * (dispatchDraft/rejectDraft/stopAgentOnManualReply; status de campanha e kill switch sao os mesmos campos que as server actions gravam).
 * Server actions dependem de cookie de sessao, por isso o mobile chama o dominio direto apos o guard Bearer.
 */
export type ActionResult =
  | { ok: true; data: unknown }
  | { ok: false; status: 400 | 403 | 404 | 409 | 429; code: string; message: string };
const good = (data: unknown): ActionResult => ({ ok: true, data });
const bad = (status: 400 | 403 | 404 | 409 | 429, code: string, message: string): ActionResult => ({ ok: false, status, code, message });
const conflict = (m: string) => bad(409, "conflict", m);

export const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,100}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DRAFT_PREVIEW_CHARS = 280;

/**
 * Pipeline comum: Bearer + dispositivo ativo, rate limit por dispositivo, Idempotency-Key opcional (replay devolve a resposta gravada),
 * execucao e auditoria SEM PII (userId, deviceId, acao, alvo=id, resultado). Corpo de mensagem/motivo nunca vai para o log.
 */
export async function mobileAction(
  req: Request,
  spec: { action: string; target: string | null; run: (a: MobileAuth) => Promise<ActionResult> },
): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const wait = hitActionLimit(a.deviceId);
  if (wait) return tooMany(wait);
  const key = req.headers.get("idempotency-key");
  if (key !== null && !IDEMPOTENCY_RE.test(key)) return invalidInput("Idempotency-Key inválida.");
  if (key) {
    const prev = await prisma.mobileActionLog.findUnique({ where: { deviceId_idempotencyKey: { deviceId: a.deviceId, idempotencyKey: key } } });
    if (prev?.respStatus) {
      const r = new Response(JSON.stringify(prev.respBody), { status: prev.respStatus, headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "Idempotent-Replayed": "true" } });
      return r;
    }
  }
  const r = await spec.run(a);
  const resp = r.ok ? ok(r.data) : fail(r.status, r.code, r.message);
  const storable = r.ok || r.status === 409;
  try {
    await prisma.mobileActionLog.create({
      data: {
        userId: a.userId, deviceId: a.deviceId, action: spec.action, target: spec.target,
        outcome: r.ok ? "ok" : `${r.status}:${r.code}`,
        idempotencyKey: storable ? key : null,
        respStatus: storable && key ? resp.status : null,
        respBody: storable && key ? ((await resp.clone().json()) as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (e) {
    if (!(typeof e === "object" && e && (e as { code?: string }).code === "P2002")) throw e;
  }
  return resp;
}

export async function paramId(ctx: { params: Promise<{ id: string }> } | { params: Promise<{ leadId: string }> }): Promise<string | null> {
  const p = (await ctx.params) as { id?: string; leadId?: string };
  const v = p.id ?? p.leadId ?? "";
  return UUID_RE.test(v) ? v : null;
}

/** Nome mascarado: primeiro nome + inicial do ultimo ("Maria S."); nome de uma palavra vira "M•••". */
export function maskDisplayName(name: string | null | undefined): string {
  const w = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "Lead";
  if (w.length === 1) return `${[...w[0]][0]}•••`;
  return `${w[0].slice(0, 20)} ${[...w[w.length - 1]][0].toUpperCase()}.`;
}

// ---------- Campanha ----------
export async function setCampaignStatus(a: MobileAuth, id: string, status: "paused" | "active"): Promise<ActionResult> {
  const orgId = await resolveOrgId(a.userId);
  if (!orgId) return bad(403, "forbidden", "Sem permissão.");
  const c = await prisma.campaign.findUnique({ where: { id }, select: { status: true, orgId: true } });
  if (!c || c.orgId !== orgId) return bad(404, "not_found", "Campanha não encontrada.");
  if (c.status === "archived") return conflict("Campanha arquivada não pode ser pausada nem retomada.");
  // Retomar so muda o status: envios seguem decididos na hora pelo scheduler/politica de envio (SPEC-017: limites, aquecimento, janela).
  if (c.status !== status) await prisma.campaign.update({ where: { id }, data: { status } });
  return good({ id, status });
}

// ---------- Kill switch ----------
export async function setKillSwitch(a: MobileAuth, killSwitch: boolean, password: string | undefined): Promise<ActionResult> {
  const user = await prisma.user.findUnique({ where: { id: a.userId }, select: { role: true, passwordHash: true } });
  const orgId = await resolveOrgId(a.userId);
  if (!user || user.role !== "provider" || !orgId) return bad(403, "forbidden", "Sem permissão.");
  // Parar os agentes (killSwitch=true) nunca tem atrito. Deixa-los rodar (killSwitch=false) exige senha atual (reautenticacao).
  if (!killSwitch) {
    const wait = reauthBlockedSeconds(a.deviceId);
    if (wait) return bad(429, "rate_limited", "Muitas tentativas de senha. Aguarde e tente novamente.");
    if (!password) return bad(403, "reauth_required", "Confirme sua senha para ligar os agentes.");
    if (!(await verifyPassword(user.passwordHash ?? "", password))) {
      recordReauthFailure(a.deviceId);
      return bad(403, "reauth_required", "Senha incorreta.");
    }
    clearReauthFailures(a.deviceId);
  }
  const s = await prisma.agentSettings.upsert({
    where: { orgId },
    create: { orgId, killSwitch, updatedBy: a.userId },
    update: { killSwitch, updatedBy: a.userId },
  });
  return good({ killSwitch: s.killSwitch });
}

// ---------- Rascunhos ----------
type DraftRow = { id: string; channel: string; subject: string | null; body: string; status: string; createdAt: Date; lead: { name: string } };
export const draftListItem = (d: DraftRow) => ({
  id: d.id, channel: d.channel, displayName: maskDisplayName(d.lead.name),
  preview: [...d.body].slice(0, DRAFT_PREVIEW_CHARS).join(""), truncated: [...d.body].length > DRAFT_PREVIEW_CHARS, createdAt: d.createdAt,
});
export const draftDetail = (d: DraftRow) => ({
  id: d.id, channel: d.channel, displayName: maskDisplayName(d.lead.name), subject: d.subject, body: d.body, status: d.status, createdAt: d.createdAt,
});
export const DRAFT_SELECT = { id: true, channel: true, subject: true, body: true, status: true, createdAt: true, lead: { select: { name: true } } } as const;

export async function approveDraftMobile(a: MobileAuth, id: string): Promise<ActionResult> {
  const orgId = await resolveOrgId(a.userId);
  if (!orgId) return bad(403, "forbidden", "Sem permissão.");
  try {
    // Mesma rota de envio do web: supressao/opt-out, cadencia, janela e limites da SPEC-017 seguem decidindo.
    // SPEC-030: orgId sempre passado — dispatchDraft nunca opera num rascunho de outro tenant.
    const r = await dispatchDraft(id, { reviewer: a.userId, orgId });
    if (r.status === "blocked") return conflict(r.reason);
    return good({ id, status: r.status });
  } catch (e) {
    if (e instanceof AppError) return e.code === "not_found" ? bad(404, "not_found", e.userMessage) : conflict(e.userMessage);
    throw e;
  }
}

export async function rejectDraftMobile(a: MobileAuth, id: string, reason: string): Promise<ActionResult> {
  const orgId = await resolveOrgId(a.userId);
  if (!orgId) return bad(403, "forbidden", "Sem permissão.");
  if (!(await prisma.draft.count({ where: { id, lead: { campaign: { orgId } } } }))) return bad(404, "not_found", "Rascunho não encontrado.");
  if (!(await rejectDraft(id, a.userId, reason, new Date(), orgId))) return conflict("Este rascunho já foi tratado.");
  return good({ id, status: "rejected" });
}

// ---------- Handoff ----------
/** Assumir: o agente para no lead e rascunhos pendentes expiram (regra SPEC-019). Nao expoe telefone/e-mail; devolve o link https da call, se houver. */
export async function takeHandoff(a: MobileAuth, leadId: string): Promise<ActionResult> {
  const orgId = await resolveOrgId(a.userId);
  if (!orgId) return bad(403, "forbidden", "Sem permissão.");
  // SPEC-030: Lead é indireto (via campaign) — nunca assume handoff de lead de outra org.
  const lead = await prisma.lead.findFirst({ where: { id: leadId, campaign: { orgId } }, select: { id: true } });
  if (!lead) return bad(404, "not_found", "Lead não encontrado.");
  await stopAgentOnManualReply(leadId);
  const l = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, select: { handoffAt: true, sequenceStatus: true } });
  const alert = await prisma.mobileAlert.findFirst({ where: { kind: "handoff", refType: "lead", refId: leadId, link: { not: null } }, orderBy: { createdAt: "desc" }, select: { link: true } });
  return good({ leadId, agentStopped: l.handoffAt !== null, handoffAt: l.handoffAt, sequenceStatus: l.sequenceStatus, link: alert?.link ?? null });
}
