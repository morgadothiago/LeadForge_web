"use server";

import { revalidatePath } from "next/cache";
import { requireOrgOwner, requireProviderOrg } from "@/lib/auth/require-admin";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { SlidingLimiter } from "@/lib/integrations/rate-limit";
import { MANUAL_TIMEOUT_MS, STALE_RUN_MS } from "@/lib/lead-search/config";
import { startLeadSearch } from "@/lib/lead-search/run";
import { idSchema } from "@/lib/schemas/campaign";
import { formError, safeAction, success, type ActionResult } from "./result";

export interface LeadSearchResult {
  /** Run criado (ou já em andamento, se `status = "running"`: duplo clique/retry devolve o mesmo run, sem nova chamada paga). */
  runId: string;
  status: "done" | "running";
  found: number;
  created: number;
  duplicate: number;
  suppressed: number;
  invalid: number;
}

export interface SearchRunStatus {
  id: string;
  status: string;
  found: number;
  created: number;
  duplicate: number;
  suppressed: number;
  invalid: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

// 1a barreira (UX) por usuário, em memória/por processo: 5 buscas / 10 min. NÃO vale entre instâncias serverless;
// a barreira real é o orçamento persistido no banco + lock advisory por campanha (run.ts `reserve`).
const limiter = new SlidingLimiter(5, 10 * 60_000);

/**
 * SPEC-058a: dispara a busca manual da campanha. SÓ o owner da org (requireOrgOwner); `campaignId` validado na org da sessão antes de
 * qualquer chamada paga. Execução síncrona (a página da campanha define maxDuration=60) com prazo total de 45 s. Erros PT-BR tipados em ActionResult.
 */
export async function searchLeads(campaignId: unknown): Promise<ActionResult<LeadSearchResult>> {
  return safeAction(async () => {
    const { user: actor, orgId } = await requireOrgOwner();
    const id = idSchema.safeParse(campaignId);
    if (!id.success) return formError("Campanha inválida.");
    if (!(await scopedPrisma(orgId).campaign.findUnique({ where: { id: id.data }, select: { id: true } }))) return formError("Campanha não encontrada.");
    const wait = limiter.hit(actor.id);
    if (wait > 0) return formError(`Muitas buscas seguidas. Tente novamente em ${wait}s.`);
    const o = await startLeadSearch(id.data, { trigger: "manual", timeoutMs: MANUAL_TIMEOUT_MS });
    revalidatePath(`/campanhas/${id.data}`);
    revalidatePath("/leads");
    if ("inProgress" in o) return success({ runId: o.inProgress, status: "running" as const, found: 0, created: 0, duplicate: 0, suppressed: 0, invalid: 0 });
    return success({ runId: o.runId, status: "done" as const, found: o.found, created: o.created, duplicate: o.duplicate, suppressed: o.suppressed, invalid: o.invalid });
  });
}

/** SPEC-058a: status de um run para polling/recuperação após refresh. Só lê runs de campanhas da org da sessão (scopedPrisma). */
export async function getSearchRunStatus(runId: unknown): Promise<ActionResult<SearchRunStatus>> {
  return safeAction(async () => {
    const { orgId } = await requireProviderOrg();
    const id = idSchema.safeParse(runId);
    if (!id.success) return formError("Busca inválida.");
    const r = await scopedPrisma(orgId).searchRun.findFirst({
      where: { id: id.data },
      select: { id: true, status: true, found: true, created: true, duplicate: true, suppressed: true, invalid: true, error: true, startedAt: true, finishedAt: true },
    });
    if (!r) return formError("Busca não encontrada.");
    // Run `running` além do STALE está preso (será marcado `failed` na próxima reserva): informa já como falha.
    if (r.status === "running" && Date.now() - r.startedAt.getTime() > STALE_RUN_MS) return success({ ...r, status: "failed", error: "Execução interrompida." });
    return success(r);
  });
}
