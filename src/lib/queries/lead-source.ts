import { requireProviderOrg } from "@/lib/auth/require-admin";
import { metaPageTokenName } from "@/lib/lead-source/secrets";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import type { CampaignStatus, LeadSourceProvider } from "@prisma/client";

/**
 * SPEC-041 (D-041-4) — leituras da seção "Captação de leads" em Configurações > Integrações.
 * Só leitura de vínculo/campanha: o Page Access Token nunca sai daqui (a view carrega apenas o hint).
 */
export interface LeadSourceBindingView {
  id: string;
  provider: LeadSourceProvider;
  externalAccountId: string;
  label: string | null;
  campaignId: string;
  campaignName: string;
  campaignStatus: CampaignStatus;
  /** Últimos 4 caracteres do Page Access Token salvo (Meta); `null` quando não há token (ou Google). */
  tokenHint: string | null;
  updatedAt: Date;
}

export interface LeadSourceCampaignOption {
  id: string;
  name: string;
}

/** Vínculos da org da sessão, com nome/status da campanha e hint do token (nunca o valor). */
export async function listLeadSourceBindings(): Promise<LeadSourceBindingView[]> {
  const { orgId } = await requireProviderOrg();
  const db = scopedPrisma(orgId);
  const [bindings, tokens] = await Promise.all([
    db.leadSourceBinding.findMany({
      include: { campaign: { select: { name: true, status: true } } },
      orderBy: [{ provider: "asc" }, { createdAt: "asc" }],
    }),
    db.integrationSecret.findMany({ where: { integration: "meta_leads" }, select: { name: true, hint: true } }),
  ]);
  const hintByName = new Map(tokens.map((t: { name: string; hint: string }) => [t.name, t.hint]));
  return bindings.map(
    (b: {
      id: string;
      provider: LeadSourceProvider;
      externalAccountId: string;
      label: string | null;
      campaignId: string;
      updatedAt: Date;
      campaign: { name: string; status: CampaignStatus };
    }) => ({
      id: b.id,
      provider: b.provider,
      externalAccountId: b.externalAccountId,
      label: b.label,
      campaignId: b.campaignId,
      campaignName: b.campaign.name,
      campaignStatus: b.campaign.status,
      tokenHint: b.provider === "meta" ? hintByName.get(metaPageTokenName(b.externalAccountId)) ?? null : null,
      updatedAt: b.updatedAt,
    }),
  );
}

/**
 * Campanhas para o seletor do vínculo. Arquivadas aparecem marcadas (e a action recusa salvar nelas):
 * o ingest devolve `campaign_archived` para elas, então esconder a campanha vinculada deixaria o motivo
 * do "lead que não chega" invisível na edição.
 */
export async function listLeadSourceCampaigns(): Promise<LeadSourceCampaignOption[]> {
  const { orgId } = await requireProviderOrg();
  const rows = await scopedPrisma(orgId).campaign.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: { id: true, name: true, status: true },
  });
  return rows.map((c: { id: string; name: string; status: CampaignStatus }) => ({
    id: c.id,
    name: c.status === "archived" ? `${c.name} (arquivada)` : c.name,
  }));
}
