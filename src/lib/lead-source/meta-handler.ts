import { prisma } from "@/lib/prisma";
import { tooManyRequests } from "@/lib/http";
import { safeErrorForLog } from "@/lib/errors";
import { getMetaAppSecret, getMetaWebhookVerifyToken, isMetaLeadsEnabled, MAX_BODY_BYTES } from "./config";
import { verifyMetaSignature } from "./signature";
import { extractContact } from "./mapping";
import { fetchLeadgenFields } from "./graph-api";
import { ingestExternalLead } from "./ingest";
import { readIntegrationSecretValue, metaPageTokenName } from "./secrets";
import { freshBucket, hit, type Bucket } from "./rate-limit";

/**
 * `GET/POST /api/integrations/leads/meta` (SPEC-041). `GET` = handshake único de inscrição do webhook na
 * Graph API (`hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`). `POST` = notificação `leadgen`
 * (etapa 1: só avisa o `leadgen_id` + `page_id`), assinada com `X-Hub-Signature-256` usando o App Secret do
 * App do Facebook (`META_APP_SECRET`, plataforma inteira — 1 App = 1 assinatura pra todas as Páginas
 * inscritas; ver `config.ts`). A assinatura é verificada ANTES de qualquer leitura/efeito colateral do
 * corpo. Depois: resolve org/campanha via `LeadSourceBinding` (D-041-3, nunca pelo App Secret) a partir do
 * `page_id`, busca o Page Access Token DESSA org em `IntegrationSecret` e chama a etapa 2 (`GET
 * /{leadgen_id}` na Graph API) para obter os dados completos do lead. Rota PÚBLICA, DESLIGADA por padrão (503).
 */
const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (body: unknown, status: number, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
const err = (status: number, error: string, message: string) => json({ error, message }, status);
const text = (body: string, status: number): Response => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export const notConfigured = (): Response => err(503, "not_configured", "Integração Meta Lead Ads desativada ou não configurada.");
export const unauthorized = (): Response => err(401, "unauthorized", "Não autorizado.");
export const methodNotAllowed = (): Response => err(405, "method_not_allowed", "Método não permitido.");

const INVALID: { windowMs: number; max: number } = { windowMs: 60_000, max: 20 };
const VALID: { windowMs: number; max: number } = { windowMs: 60_000, max: 600 };
let invalidBucket: Bucket = freshBucket();
let validBucket: Bucket = freshBucket();
export const _resetMetaRateLimit = (): void => {
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

export interface MetaDeps {
  enabled?: boolean;
}

/** Handshake de inscrição (Graph API `GET` no cadastro do webhook no App do Facebook). */
export async function handleMetaVerify(req: Request, deps: MetaDeps = {}): Promise<Response> {
  const enabled = deps.enabled !== undefined ? deps.enabled : isMetaLeadsEnabled();
  if (!enabled) return notConfigured();
  const verifyToken = getMetaWebhookVerifyToken();
  if (!verifyToken) return notConfigured();

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !token || token !== verifyToken || !challenge) {
    const r = hit(invalidBucket, INVALID);
    invalidBucket = r.b;
    return r.wait !== null ? tooManyRequests(r.wait) : unauthorized();
  }
  return text(challenge, 200);
}

interface LeadgenChange {
  pageId: string;
  leadgenId: string;
}

function extractLeadgenChanges(payload: unknown): LeadgenChange[] {
  if (!payload || typeof payload !== "object") return [];
  const entries = (payload as Record<string, unknown>).entry;
  if (!Array.isArray(entries)) return [];
  const out: LeadgenChange[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const changes = Array.isArray(e.changes) ? e.changes : [];
    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const c = change as Record<string, unknown>;
      if (c.field !== "leadgen") continue;
      const value = c.value;
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      const pageId = typeof v.page_id === "string" ? v.page_id : typeof e.id === "string" ? e.id : null;
      const leadgenId = typeof v.leadgen_id === "string" ? v.leadgen_id : typeof v.leadgen_id === "number" ? String(v.leadgen_id) : null;
      if (pageId && leadgenId) out.push({ pageId, leadgenId });
    }
  }
  return out;
}

/** Notificação `leadgen` (POST). Só avisa `leadgen_id` — os dados completos vêm da etapa 2 (Graph API). */
export async function handleMetaWebhook(req: Request, deps: MetaDeps = {}): Promise<Response> {
  const enabled = deps.enabled !== undefined ? deps.enabled : isMetaLeadsEnabled();
  if (!enabled) return notConfigured();
  const appSecret = getMetaAppSecret();
  if (!appSecret) return notConfigured();

  const body = await readBodyLimited(req);
  if (body === null) return err(413, "payload_too_large", "Corpo excede o limite de 1 MB.");

  // Assinatura verificada ANTES de qualquer parse/uso do corpo — nenhum efeito colateral antes desta linha.
  const signatureHeader = req.headers.get("x-hub-signature-256");
  if (!verifyMetaSignature(body, signatureHeader, appSecret)) {
    const r = hit(invalidBucket, INVALID);
    invalidBucket = r.b;
    return r.wait !== null ? tooManyRequests(r.wait) : unauthorized();
  }
  const v = hit(validBucket, VALID);
  validBucket = v.b;
  if (v.wait !== null) return tooManyRequests(v.wait);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return err(400, "invalid_json", "JSON inválido.");
  }
  const changes = extractLeadgenChanges(parsed);
  if (!changes.length) return json({ status: "ignored" }, 200);

  const results: { pageId: string; leadgenId: string; status: string }[] = [];
  for (const { pageId, leadgenId } of changes) {
    try {
      // Resolução de org/campanha SEMPRE via LeadSourceBinding (D-041-3) — nunca pelo App Secret (esse só
      // garante que a chamada veio da Meta; não diz de qual org/página).
      const binding = await prisma.leadSourceBinding.findUnique({
        where: { provider_externalAccountId: { provider: "meta", externalAccountId: pageId } },
        select: { orgId: true, campaignId: true },
      });
      if (!binding) {
        results.push({ pageId, leadgenId, status: "unknown_page" });
        continue;
      }
      const pageToken = await readIntegrationSecretValue(binding.orgId, "meta_leads", metaPageTokenName(pageId));
      if (!pageToken) {
        console.error(`[integrations/leads/meta] Page Access Token ausente para orgId=${binding.orgId} (página não identificada no log).`);
        results.push({ pageId, leadgenId, status: "no_page_token" });
        continue;
      }
      const fetched = await fetchLeadgenFields(leadgenId, pageToken);
      if (!fetched.ok) {
        results.push({ pageId, leadgenId, status: `fetch_${fetched.reason}` });
        continue;
      }
      const contact = extractContact(fetched.fields);
      const result = await ingestExternalLead({
        source: "meta_leads",
        orgId: binding.orgId,
        campaignId: binding.campaignId,
        externalLeadId: leadgenId,
        contact,
      });
      results.push({ pageId, leadgenId, status: result.status });
    } catch (e) {
      console.error("[integrations/leads/meta] erro ao processar leadgen:", safeErrorForLog(e));
      results.push({ pageId, leadgenId, status: "internal_error" });
    }
  }
  console.info(`[integrations/leads/meta] total=${results.length}`);
  return json({ results }, 200);
}
