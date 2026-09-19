import type { Channel, Prisma, Stage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { boardParamsSchema, STAGES, type BoardParams } from "@/lib/schemas/pipeline";

export interface BoardCard {
  id: string;
  stage: Stage;
  position: number;
  value: number | null;
  notes: string | null;
  lostReason?: string | null;
  lead: { id: string; name: string; company: string | null; score: number };
  /** Canal do último touch do lead; null se ainda sem touches. */
  channel: Channel | null;
  campaign: { id: string; name: string };
}

export interface BoardColumn {
  stage: Stage;
  label: string;
  count: number;
  totalValue: number;
  cards: BoardCard[];
}

export const STAGE_LABELS: Record<Stage, string> = {
  novo_lead: "Novo Lead",
  contactado: "Contactado",
  em_followup: "Em Follow-up",
  interessado: "Interessado",
  reuniao_agendada: "Reunião Agendada",
  fechado: "Fechado",
  perdido: "Perdido",
};

/**
 * Board: 1 query de oportunidades (lead, campanha e último touch via include/select aninhado,
 * resolvido pelo Prisma em batch, sem N+1). Sem limite por coluna (SPEC omissa).
 * Contadores e soma de valor refletem filtro de campanha e busca.
 */
export async function getPipelineBoard(params: BoardParams = {}): Promise<BoardColumn[]> {
  await requireUser();
  const { campaignId, q } = boardParamsSchema.parse(params);
  const where: Prisma.OpportunityWhereInput = {
    ...(campaignId ? { campaignId } : {}),
    ...(q
      ? {
          lead: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { company: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };
  const rows = await prisma.opportunity.findMany({
    where,
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      stage: true,
      position: true,
      value: true,
      notes: true,
      lostReason: true,
      campaign: { select: { id: true, name: true } },
      lead: {
        select: {
          id: true,
          name: true,
          company: true,
          score: true,
          touches: { select: { channel: true }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  const columns: BoardColumn[] = STAGES.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    count: 0,
    totalValue: 0,
    cards: [],
  }));
  const byStage = new Map(columns.map((c) => [c.stage, c]));
  for (const r of rows) {
    const col = byStage.get(r.stage);
    if (!col) continue;
    col.count += 1;
    col.totalValue += r.value ?? 0;
    col.cards.push({
      id: r.id,
      stage: r.stage,
      position: r.position,
      value: r.value,
      notes: r.notes,
      lostReason: r.lostReason,
      lead: { id: r.lead.id, name: r.lead.name, company: r.lead.company, score: r.lead.score },
      channel: r.lead.touches[0]?.channel ?? null,
      campaign: r.campaign,
    });
  }
  return columns;
}
