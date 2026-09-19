import { handleCronTick, methodNotAllowed } from "@/lib/scheduler/cron-endpoint";

/**
 * SPEC-013. Rota PÚBLICA para o proxy (isenta de login em src/proxy.ts); a autenticação é o Bearer CRON_SECRET.
 * GET tem efeito colateral (Vercel Cron só chama GET): `dynamic = "force-dynamic"` + Cache-Control no-store evitam cache.
 * `maxDuration` (60 s) >= orçamento efetivo da rodada (default 25 s, teto 25 s) + pior caso de um envio (30 s) + margem (5 s); ver scheduler/config.ts.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  return handleCronTick(req);
}
export async function GET(req: Request): Promise<Response> {
  return handleCronTick(req);
}
// Demais métodos: 405 explícito (HEAD não pode disparar a rodada; OPTIONS/PUT/PATCH/DELETE idem).
export const HEAD = async (): Promise<Response> => methodNotAllowed();
export const OPTIONS = async (): Promise<Response> => methodNotAllowed();
export const PUT = async (): Promise<Response> => methodNotAllowed();
export const PATCH = async (): Promise<Response> => methodNotAllowed();
export const DELETE = async (): Promise<Response> => methodNotAllowed();
