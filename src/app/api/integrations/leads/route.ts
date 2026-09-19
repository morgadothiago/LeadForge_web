import { handleIngest, methodNotAllowed } from "@/lib/lead-ingest/handler";

/**
 * SPEC-014. Rota PÚBLICA para o proxy (isenta em src/proxy.ts); a autenticação é o Bearer INGEST_SECRET e o endpoint
 * fica DESLIGADO (503) sem INTEGRATION_LEADS_ENABLED=true. Efeito colateral => sem cache. Corpo lido do stream (teto 1 MB).
 * maxDuration: até 100 itens sequenciais.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  return handleIngest(req);
}
export const GET = async (): Promise<Response> => methodNotAllowed();
export const HEAD = async (): Promise<Response> => methodNotAllowed();
export const OPTIONS = async (): Promise<Response> => methodNotAllowed();
export const PUT = async (): Promise<Response> => methodNotAllowed();
export const PATCH = async (): Promise<Response> => methodNotAllowed();
export const DELETE = async (): Promise<Response> => methodNotAllowed();
