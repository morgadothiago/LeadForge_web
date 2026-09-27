import { handleGoogleAdsWebhook, methodNotAllowed } from "@/lib/lead-source/google-ads-handler";

/**
 * SPEC-041 (D-041-1). Rota PÚBLICA (isenta em src/proxy.ts, mesmo padrão de `/api/integrations/leads`
 * SPEC-014). Autenticação/identificação: `google_key` no corpo, resolvido via `LeadSourceBinding`
 * (D-041-3) — nunca um segredo global. DESLIGADA (503) sem INTEGRATION_LEADS_GOOGLE_ADS_ENABLED=true.
 * Sem cache (efeito colateral). Corpo lido do stream (teto 1 MB).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  return handleGoogleAdsWebhook(req);
}
export const GET = async (): Promise<Response> => methodNotAllowed();
export const HEAD = async (): Promise<Response> => methodNotAllowed();
export const OPTIONS = async (): Promise<Response> => methodNotAllowed();
export const PUT = async (): Promise<Response> => methodNotAllowed();
export const PATCH = async (): Promise<Response> => methodNotAllowed();
export const DELETE = async (): Promise<Response> => methodNotAllowed();
