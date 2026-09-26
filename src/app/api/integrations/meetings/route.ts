import { handleMeetingWebhook, methodNotAllowed } from "@/lib/meetings/webhook";

/** SPEC-028. Rota PUBLICA para o proxy (isenta em src/proxy.ts /api/integrations/*); auth = Bearer INGEST_SECRET no handler. Efeito colateral => sem cache. */
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleMeetingWebhook(req);
}
export const GET = async (): Promise<Response> => methodNotAllowed();
export const HEAD = async (): Promise<Response> => methodNotAllowed();
export const OPTIONS = async (): Promise<Response> => methodNotAllowed();
export const PUT = async (): Promise<Response> => methodNotAllowed();
export const PATCH = async (): Promise<Response> => methodNotAllowed();
export const DELETE = async (): Promise<Response> => methodNotAllowed();
