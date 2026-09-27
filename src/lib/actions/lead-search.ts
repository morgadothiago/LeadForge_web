"use server";

import { revalidatePath } from "next/cache";
import { requireActiveProviderOrg } from "@/lib/auth/require-admin";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { SlidingLimiter } from "@/lib/integrations/rate-limit";
import { runLeadSearch } from "@/lib/lead-search/run";
import { idSchema } from "@/lib/schemas/campaign";
import { formError, safeAction, success, type ActionResult } from "./result";

export interface LeadSearchResult {
  found: number;
  created: number;
  duplicate: number;
  suppressed: number;
  invalid: number;
}

// Rate limit simples por usuário (em memória, por processo): 5 buscas / 10 min.
const limiter = new SlidingLimiter(5, 10 * 60_000);

/** Dispara a busca manual de leads da campanha (provider dono da org). Erros de limite/config vêm em PT-BR do backend. */
export async function searchLeads(campaignId: unknown): Promise<ActionResult<LeadSearchResult>> {
  return safeAction(async () => {
    const { user: actor, orgId } = await requireActiveProviderOrg();
    const id = idSchema.safeParse(campaignId);
    if (!id.success) return formError("Campanha inválida.");
    if (!(await scopedPrisma(orgId).campaign.findUnique({ where: { id: id.data }, select: { id: true } }))) return formError("Campanha não encontrada.");
    const wait = limiter.hit(actor.id);
    if (wait > 0) return formError(`Muitas buscas seguidas. Tente novamente em ${wait}s.`);
    const o = await runLeadSearch(id.data, { trigger: "manual" });
    revalidatePath(`/campanhas/${id.data}`);
    revalidatePath("/leads");
    return success({ found: o.found, created: o.created, duplicate: o.duplicate, suppressed: o.suppressed, invalid: o.invalid });
  });
}
