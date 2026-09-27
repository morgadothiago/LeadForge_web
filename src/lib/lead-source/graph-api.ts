import { safeErrorForLog } from "@/lib/errors";
import { fieldsFromMetaFieldData } from "./mapping";

/**
 * Etapa 2 do fluxo Meta Lead Ads (SPEC-041): `GET /{leadgen_id}` na Graph API, autenticado com o Page
 * Access Token DA ORG/PÁGINA correta (resolvida via `LeadSourceBinding` + `IntegrationSecret`, nunca um
 * token global). O `leadgen_id` sozinho (etapa 1, webhook) não traz os dados do lead.
 */
const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";
let deadlineMs = 10_000;
/** Só testes. */
export function _setGraphApiDeadline(ms: number | null): void {
  deadlineMs = ms ?? 10_000;
}

export type FetchImpl = typeof fetch;
let fetchImpl: FetchImpl = fetch;
/** Só testes: injeta um fetch fake (nunca chama a Graph API real em teste). */
export function _setGraphApiFetch(fn: FetchImpl | null): void {
  fetchImpl = fn ?? fetch;
}

export interface LeadgenFetchResult {
  ok: true;
  fields: { key: string; value: string }[];
}
export interface LeadgenFetchError {
  ok: false;
  reason: "not_found" | "unauthorized" | "upstream" | "timeout";
}

export async function fetchLeadgenFields(leadgenId: string, pageAccessToken: string): Promise<LeadgenFetchResult | LeadgenFetchError> {
  const url = new URL(`${GRAPH_API_BASE}/${encodeURIComponent(leadgenId)}`);
  url.searchParams.set("fields", "field_data");
  url.searchParams.set("access_token", pageAccessToken);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), deadlineMs);
  try {
    const res = await fetchImpl(url.toString(), { method: "GET", signal: controller.signal });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "unauthorized" };
    if (res.status === 404) return { ok: false, reason: "not_found" };
    if (!res.ok) return { ok: false, reason: "upstream" };
    const body: unknown = await res.json();
    const fieldData = body && typeof body === "object" ? (body as Record<string, unknown>).field_data : undefined;
    return { ok: true, fields: fieldsFromMetaFieldData(fieldData) };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    console.error("[lead-source/meta] falha ao buscar leadgen na Graph API:", safeErrorForLog(e));
    return { ok: false, reason: aborted ? "timeout" : "upstream" };
  } finally {
    clearTimeout(t);
  }
}
