"use server";

import { requireUser, UnauthorizedError } from "@/lib/auth/require-user";
import { countStartableLeads, type StartableLeadsCount } from "@/lib/queries/sequence-start";
import { safeErrorForLog } from "@/lib/errors";

/**
 * Wrapper Server Action: `countStartableLeads` é uma query (não invocável do cliente). Carregada sob demanda ao abrir o diálogo.
 * Exige sessão explicitamente (`requireUser`) e NUNCA lança UnauthorizedError ao cliente: sem sessão/erro -> `null` (a UI mostra mensagem).
 * Mantém o contrato `StartableLeadsCount | null` porque o componente consumidor (fora do escopo do backend) depende dele.
 * PENDENTE (UI): migrar para ActionResult com mensagem distinta de "sessão expirada".
 */
export async function loadStartableCount(campaignId: string): Promise<StartableLeadsCount | null> {
  try {
    await requireUser();
    if (typeof campaignId !== "string" || !campaignId) return null;
    return await countStartableLeads(campaignId);
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) console.error("[action] erro inesperado:", safeErrorForLog(e));
    return null;
  }
}
