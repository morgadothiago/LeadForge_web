import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tooManyRequests } from "@/lib/http";
import { safeErrorForLog } from "@/lib/errors";
import { withSerializableRetry } from "@/lib/db/tx-conflict";
import { createLeadCore } from "@/lib/domain/lead-create";
import { findSuppression } from "@/lib/domain/suppression";
import { bearerToken, secretsMatch } from "@/lib/scheduler/cron-endpoint";
import { getIngestSecret, isIngestEnabled, MAX_BODY_BYTES } from "./config";
import { envelopeSchema, itemSchema, reasonFrom } from "./schema";

/**
 * POST /api/integrations/leads (SPEC-014). Autenticado SÓ por Bearer INGEST_SECRET; desligado por padrão.
 * Nunca loga nem persiste PII/segredo: WebhookEvent guarda só contadores e ids.
 */
export const AUDIT_SOURCE = "lead_ingest";

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (body: unknown, status: number, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
const err = (status: number, error: string, message: string, extra: Record<string, string> = {}) => json({ error, message }, status, extra);

export const unauthorized = () => err(401, "unauthorized", "Não autorizado.", { "WWW-Authenticate": "Bearer" });
export const notConfigured = () => err(503, "not_configured", "Integração de leads desativada ou não configurada.");
export const methodNotAllowed = () => err(405, "method_not_allowed", "Método não permitido.", { Allow: "POST" });

// Tentativas INVÁLIDAS: uma única chave global (memória constante, nada por segredo forjado). Credencial válida tem teto próprio, generoso.
const INVALID = { windowMs: 60_000, max: 20 };
const VALID = { windowMs: 60_000, max: 600 };
type Bucket = { count: number; resetAt: number };
let invalidBucket: Bucket = { count: 0, resetAt: 0 };
let validBucket: Bucket = { count: 0, resetAt: 0 };
export const _resetIngestRateLimit = (): void => {
  invalidBucket = { count: 0, resetAt: 0 };
  validBucket = { count: 0, resetAt: 0 };
};
function hit(b: Bucket, cfg: { windowMs: number; max: number }, now = Date.now()): { b: Bucket; wait: number | null } {
  if (b.resetAt <= now) b = { count: 0, resetAt: now + cfg.windowMs };
  b.count++;
  return { b, wait: b.count > cfg.max ? Math.max(1, Math.ceil((b.resetAt - now) / 1000)) : null };
}

/** Lê o corpo do stream com teto REAL (não confia em content-length). null = excedeu. */
export async function readBodyLimited(req: Request, max = MAX_BODY_BYTES): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type ItemStatus = "created" | "duplicate" | "suppressed" | "invalid";
export interface ItemResult {
  index: number;
  status: ItemStatus;
  leadId?: string;
  reason?: string;
}
export interface IngestSummary {
  campaignId: string;
  total: number;
  created: number;
  duplicate: number;
  suppressed: number;
  invalid: number;
  results: ItemResult[];
  warnings?: string[];
}

/** Reserva `processing` mais velha que isto é considerada abandonada (processo caiu) e pode ser reassumida. */
export const IDEMPOTENCY_PROCESSING_TTL_MS = 2 * 60_000;
let clock: () => number = () => Date.now();
/** Só para testes: relógio injetável. Sem argumento restaura o real. */
export const _setIngestClock = (fn?: () => number): void => {
  clock = fn ?? (() => Date.now());
};

const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
      : v;
/** SHA-256 de JSON canônico (chaves ordenadas) do corpo validado; o corpo em si nunca é guardado. */
const bodyHashOf = (campaignId: string, leads: unknown[]) => createHash("sha256").update(JSON.stringify(canonical({ campaignId, leads }))).digest("hex");

const KEY_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const eventIdFor = (key: string) => `lead_ingest:${createHash("sha256").update(key).digest("hex")}`;

export async function processItem(campaignId: string, raw: unknown, index: number): Promise<ItemResult> {
  const p = itemSchema.safeParse(raw);
  if (!p.success) return { index, status: "invalid", reason: reasonFrom(p.error) };
  const d = p.data;
  const contact = { email: d.email, phone: d.phone };
  const dup = await prisma.lead.findFirst({
    where: { campaignId, OR: [...(d.email ? [{ email: d.email }] : []), ...(d.phone ? [{ phone: d.phone }] : [])] },
    select: { id: true },
  });
  if (dup) return { index, status: "duplicate", leadId: dup.id };
  if (await findSuppression(contact)) return { index, status: "suppressed" };
  try {
    const out = await withSerializableRetry(() =>
      prisma.$transaction(
        (tx) =>
          createLeadCore(tx, {
            campaignId,
            name: d.name,
            company: d.company,
            email: d.email,
            phone: d.phone,
            website: d.website,
            linkedin: d.linkedin,
            source: d.source ?? "integration",
            tags: d.tags,
            ...(d.externalId ? { rawData: { externalId: d.externalId } } : {}),
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
    return { index, status: "created", leadId: out.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { index, status: "duplicate" };
    throw e;
  }
}

const toJson = (s: IngestSummary) => s as unknown as Prisma.InputJsonValue;

export interface IngestDeps {
  secret?: string | null;
  enabled?: boolean;
}

export async function handleIngest(req: Request, deps: IngestDeps = {}): Promise<Response> {
  const secret = deps.secret !== undefined ? deps.secret : getIngestSecret();
  const enabled = deps.enabled !== undefined ? deps.enabled : isIngestEnabled();
  if (!enabled || !secret) return notConfigured();

  const token = bearerToken(req);
  if (!token || !secretsMatch(token, secret)) {
    const r = hit(invalidBucket, INVALID);
    invalidBucket = r.b;
    return r.wait !== null ? tooManyRequests(r.wait) : unauthorized();
  }
  const v = hit(validBucket, VALID);
  validBucket = v.b;
  if (v.wait !== null) return tooManyRequests(v.wait);

  const idemKey = req.headers.get("idempotency-key");
  if (idemKey !== null && !KEY_RE.test(idemKey)) return err(400, "invalid_idempotency_key", "Idempotency-Key inválida: use 1 a 128 caracteres (letras, números, . _ : -).");

  let claimed: string | null = null;
  try {
    const body = await readBodyLimited(req);
    if (body === null) return err(413, "payload_too_large", "Corpo excede o limite de 1 MB.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return err(400, "invalid_json", "JSON inválido.");
    }
    const env = envelopeSchema.safeParse(parsed);
    if (!env.success) return json({ error: "validation_error", message: "Payload inválido.", details: [...new Set(env.error.issues.map((i) => i.message))] }, 400);
    const { campaignId, leads } = env.data;

    const bodyHash = bodyHashOf(campaignId, leads);
    if (idemKey !== null) {
      const eventId = eventIdFor(idemKey);
      const processing = { state: "processing", campaignId, total: leads.length, bodyHash };
      try {
        await prisma.webhookEvent.create({ data: { source: AUDIT_SOURCE, eventId, payload: processing, createdAt: new Date(clock()) } });
        claimed = eventId;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
        const prev = await prisma.webhookEvent.findUnique({ where: { eventId }, select: { payload: true, processedAt: true } });
        const pl = prev?.payload as { campaignId?: string; total?: number; bodyHash?: string } | null;
        const busy = () => err(409, "in_progress", "Requisição com esta Idempotency-Key ainda em processamento.", { "Retry-After": "1" });
        if (!prev) return busy();
        if (!prev.processedAt) {
          // Reserva abandonada (TTL): reivindicação atômica; só uma repetição simultânea vence.
          const now = clock();
          const won = await prisma.webhookEvent.updateMany({
            where: { eventId, processedAt: null, createdAt: { lte: new Date(now - IDEMPOTENCY_PROCESSING_TTL_MS) } },
            data: { createdAt: new Date(now), payload: processing },
          });
          if (won.count !== 1) return busy();
          claimed = eventId;
        } else {
          const same = pl?.bodyHash !== undefined ? pl.bodyHash === bodyHash : pl?.campaignId === campaignId && pl?.total === leads.length;
          if (!same) return err(422, "idempotency_conflict", "Esta chave de idempotência já foi usada com outro conteúdo.");
          const rest = { ...((prev.payload ?? {}) as Record<string, unknown>) };
          delete rest.bodyHash;
          return json({ ...rest, idempotentReplay: true }, 200);
        }
      }
    }

    const camp = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true, status: true } });
    if (!camp || camp.status === "archived") {
      if (claimed) await prisma.webhookEvent.delete({ where: { eventId: claimed } }).catch(() => undefined);
      return camp ? err(409, "campaign_archived", "Campanha arquivada: não aceita novos leads.") : err(404, "campaign_not_found", "Campanha não encontrada.");
    }

    const results: ItemResult[] = [];
    for (const [i, raw] of leads.entries()) results.push(await processItem(campaignId, raw, i));
    const count = (s: ItemStatus) => results.filter((r) => r.status === s).length;
    const summary: IngestSummary = { campaignId, total: results.length, created: count("created"), duplicate: count("duplicate"), suppressed: count("suppressed"), invalid: count("invalid"), results };

    // Leads já criados: falha ao gravar a auditoria NÃO vira 500 (esconderia a criação parcial).
    // Devolve 200 com o resultado por item + warnings; a chave é liberada (retry cai em `duplicate` com leadId, sem recriar).
    let warnings: string[] | undefined;
    try {
      const stored = { ...summary, ...(claimed ? { bodyHash } : {}) };
      if (claimed) await prisma.webhookEvent.update({ where: { eventId: claimed }, data: { payload: toJson(stored as IngestSummary), processedAt: new Date() } });
      else await prisma.webhookEvent.create({ data: { source: AUDIT_SOURCE, payload: toJson(summary), processedAt: new Date() } });
    } catch (auditErr) {
      console.error("[integrations/leads] auditoria não gravada:", safeErrorForLog(auditErr));
      warnings = ["auditoria_nao_gravada"];
      if (claimed) await prisma.webhookEvent.delete({ where: { eventId: claimed } }).catch(() => undefined);
      claimed = null;
    }
    console.info(`[integrations/leads] total=${summary.total} criados=${summary.created} duplicados=${summary.duplicate} suprimidos=${summary.suppressed} invalidos=${summary.invalid}`);
    return json(warnings ? { ...summary, warnings } : summary, 200);
  } catch (e) {
    if (claimed) await prisma.webhookEvent.delete({ where: { eventId: claimed } }).catch(() => undefined);
    console.error("[integrations/leads] erro:", safeErrorForLog(e));
    return err(500, "internal", "Falha ao processar a ingestão. Tente novamente.");
  }
}
