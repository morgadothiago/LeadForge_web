"use server";

import { requireProviderOrg } from "@/lib/auth/require-admin";
import { searchLeadsForMeeting, type LeadOpportunityOption } from "@/lib/queries/meetings";
import { success, safeAction, type ActionResult } from "./result";

/** SPEC-029: ponte fina para o dialog (query da SPEC-028 nao e chamavel do cliente). Sem contrato novo.
 * `searchLeadsForMeeting` ja exige `requireProviderOrg()` e escopa por org (SPEC-030); guard explícito
 * aqui também por defesa em profundidade. */
export async function searchMeetingLeads(q: string): Promise<ActionResult<LeadOpportunityOption[]>> {
  return safeAction(async () => {
    await requireProviderOrg();
    return success(await searchLeadsForMeeting(q));
  });
}
