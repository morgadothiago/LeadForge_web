import { prisma } from "@/lib/prisma";
import { tooManyRequests } from "@/lib/http";
import { safeErrorForLog } from "@/lib/errors";
import { isGoogleAdsLeadsEnabled, MAX_BODY_BYTES } from "./config";
import { extractContact, fieldsFromGoogleUserColumnData } from "./mapping";
import { ingestExternalLead } from "./ingest";
import { freshBucket, hit, type Bucket } from "./rate-limit";

/**
 * `POST /api/integrations/leads/google-ads` (SPEC-041, D-041-1: webhook direto). O Google Ads envia, a cada
 * novo lead da extensão de formulário, um JSON contendo `google_key` (segredo configurado pelo Provider na
 * extensão — ver `LeadSourceBinding.externalAccountId`, D-041-3) + `lead_id` + `user_column_data`. Sem
 * assinatura HMAC separada: o próprio `google_key` identifica E autentica de onde o lead veio (mesmo padrão
 * de `WhatsAppInstance.webhookToken` já usado no projeto) — NUNCA um segredo global compartilhado entre orgs.
 * Rota PÚBLICA (isenta em `src/proxy.ts` por `/api/integrations/*`). DESLIGADA por padrão (503).
 */
const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (body: unknown, status: number, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
const err = (status: number, error: string, message: string) => json({ error, message }, status);

export const notConfigured = (): Response => err(503, "not_configured", "Integração Google Ads Lead Form desativada ou não configurada.");
export const unauthorized = (): Response => err(401, "unauthorized", "Não autorizado.");
export const methodNotAllowed = (): Response => err(405, "method_not_allowed", "Método não permitido.");

const INVALID: { windowMs: number; max: number } = { windowMs: 60_000, max: 20 };
const VALID: { windowMs: number; max: number } = { windowMs: 60_000, max: 600 };
let invalidBucket: Bucket = freshBucket();
let validBucket: Bucket = freshBucket();
export const _resetGoogleAdsRateLimit = (): void => {
  invalidBucket = freshBucket();
  validBucket = freshBucket();
};

async function readBodyLimited(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const GOOGLE_KEY_RE = /^[A-Za-z0-9._:-]{1,200}$/;

export interface GoogleAdsDeps {
  enabled?: boolean;
}

export async function handleGoogleAdsWebhook(req: Request, deps: GoogleAdsDeps = {}): Promise<Response> {
  const enabled = deps.enabled !== undefined ? deps.enabled : isGoogleAdsLeadsEnabled();
  if (!enabled) return notConfigured();

  const body = await readBodyLimited(req);
  if (body === null) return err(413, "payload_too_large", "Corpo excede o limite de 1 MB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return err(400, "invalid_json", "JSON inválido.");
  }
  if (!parsed || typeof parsed !== "object") return err(400, "invalid_json", "Corpo inválido: esperado um objeto JSON.");
  const p = parsed as Record<string, unknown>;
  const googleKey = typeof p.google_key === "string" ? p.google_key.trim() : "";
  const leadId = typeof p.lead_id === "string" ? p.lead_id.trim() : typeof p.lead_id === "number" ? String(p.lead_id) : "";

  if (!googleKey || !GOOGLE_KEY_RE.test(googleKey) || !leadId) {
    const r = hit(invalidBucket, INVALID);
    invalidBucket = r.b;
    return r.wait !== null ? tooManyRequests(r.wait) : unauthorized();
  }

  // Resolução de org/campanha SEMPRE via LeadSourceBinding (D-041-3) — nunca um segredo global.
  // Leitura pura (sem efeito colateral): é o que autentica E identifica a origem, simultaneamente.
  const binding = await prisma.leadSourceBinding.findUnique({
    where: { provider_externalAccountId: { provider: "google_ads", externalAccountId: googleKey } },
    select: { orgId: true, campaignId: true },
  });
  if (!binding) {
    const r = hit(invalidBucket, INVALID);
    invalidBucket = r.b;
    return r.wait !== null ? tooManyRequests(r.wait) : unauthorized();
  }

  const v = hit(validBucket, VALID);
  validBucket = v.b;
  if (v.wait !== null) return tooManyRequests(v.wait);

  try {
    const contact = extractContact(fieldsFromGoogleUserColumnData(p.user_column_data));
    const result = await ingestExternalLead({
      source: "google_ads_leads",
      orgId: binding.orgId,
      campaignId: binding.campaignId,
      externalLeadId: leadId,
      contact,
    });
    console.info(`[integrations/leads/google-ads] status=${result.status}`);
    return json({ status: result.status }, 200);
  } catch (e) {
    console.error("[integrations/leads/google-ads] erro:", safeErrorForLog(e));
    return err(500, "internal", "Falha ao processar o lead. Tente novamente.");
  }
}
