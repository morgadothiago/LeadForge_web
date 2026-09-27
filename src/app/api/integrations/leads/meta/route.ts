import { handleMetaVerify, handleMetaWebhook, methodNotAllowed } from "@/lib/lead-source/meta-handler";

/**
 * SPEC-041. Rota PÚBLICA (isenta em src/proxy.ts). `GET` = handshake de inscrição do webhook na Graph API
 * (`hub.verify_token`). `POST` = notificação `leadgen`, assinada com `X-Hub-Signature-256` (App Secret) —
 * verificada ANTES de qualquer efeito colateral. DESLIGADA (503) sem INTEGRATION_LEADS_META_ENABLED=true.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request): Promise<Response> {
  return handleMetaVerify(req);
}
export async function POST(req: Request): Promise<Response> {
  return handleMetaWebhook(req);
}
export const HEAD = async (): Promise<Response> => methodNotAllowed();
export const OPTIONS = async (): Promise<Response> => methodNotAllowed();
export const PUT = async (): Promise<Response> => methodNotAllowed();
export const PATCH = async (): Promise<Response> => methodNotAllowed();
export const DELETE = async (): Promise<Response> => methodNotAllowed();
