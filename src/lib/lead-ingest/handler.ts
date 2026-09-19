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
}

const KEY_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const eventIdFor = (key: string) => `lead_ingest:${createHash("sha256").update(key).digest("hex")}`;

async function processItem(campaignId: string, raw: unknown, index: number): Promise<ItemResult> {
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

    if (idemKey !== null) {
      const eventId = eventIdFor(idemKey);
      try {
        await prisma.webhookEvent.create({ data: { source: AUDIT_SOURCE, eventId, payload: { state: "processing", campaignId, total: leads.length } } });
        claimed = eventId;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
        const prev = await prisma.webhookEvent.findUnique({ where: { eventId }, select: { payload: true, processedAt: true } });
        const pl = prev?.payload as { campaignId?: string; total?: number } | null;
        if (!prev || !prev.processedAt) return err(409, "in_progress", "Requisição com esta Idempotency-Key ainda em processamento.", { "Retry-After": "1" });
        if (pl?.campaignId !== campaignId || pl?.total !== leads.length) return err(422, "idempotency_conflict", "Idempotency-Key já usada com outro corpo.");
        return json({ ...(prev.payload as object), idempotentReplay: true }, 200);
      }
    }

    const camp = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } });
    if (!camp) {
      if (claimed) await prisma.webhookEvent.delete({ where: { eventId: claimed } }).catch(() => undefined);
      return err(404, "campaign_not_found", "Campanha não encontrada.");
    }

    const results: ItemResult[] = [];
    for (const [i, raw] of leads.entries()) results.push(await processItem(campaignId, raw, i));
    const count = (s: ItemStatus) => results.filter((r) => r.status === s).length;
    const summary: IngestSummary = { campaignId, total: results.length, created: count("created"), duplicate: count("duplicate"), suppressed: count("suppressed"), invalid: count("invalid"), results };

    if (claimed) await prisma.webhookEvent.update({ where: { eventId: claimed }, data: { payload: toJson(summary), processedAt: new Date() } });
    else await prisma.webhookEvent.create({ data: { source: AUDIT_SOURCE, payload: toJson(summary), processedAt: new Date() } });
    console.info(`[integrations/leads] total=${summary.total} criados=${summary.created} duplicados=${summary.duplicate} suprimidos=${summary.suppressed} invalidos=${summary.invalid}`);
    return json(summary, 200);
  } catch (e) {
    if (claimed) await prisma.webhookEvent.delete({ where: { eventId: claimed } }).catch(() => undefined);
    console.error("[integrations/leads] erro:", safeErrorForLog(e));
    return err(500, "internal", "Falha ao processar a ingestão. Tente novamente.");
  }
}
