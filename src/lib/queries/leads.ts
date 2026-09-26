import { Prisma, type Channel, type SequenceStatus, type Stage, type TouchDirection, type TouchStatus } from "@prisma/client";
import { requireProviderOrg } from "@/lib/auth/require-admin";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { suppressedIds } from "@/lib/domain/suppression";
import { getLastInboundByLead, sanitizeInboundText } from "@/lib/whatsapp/last-inbound";
import { leadListParamsSchema, type LeadListParams } from "@/lib/schemas/lead";

export interface LeadListItem {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  score: number;
  tags: string[];
  sequenceStatus: SequenceStatus;
  createdAt: Date;
  campaign: { id: string; name: string };
  opportunity: { id: string; stage: Stage; value: number | null } | null;
  /** Canal do último touch (mais recente por createdAt); null sem touches. */
  lastChannel: Channel | null;
  /** SPEC-012 (aditivo/opcional). */
  lastInboundAt?: Date | null;
  lastInboundText?: string | null;
  possibleOptOut?: boolean;
  /** SPEC-017 (aditivo): e-mail/telefone na lista de supressão global; envios bloqueados. */
  suppressed?: boolean;
}

export interface LeadListResult {
  items: LeadListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * Listagem paginada por offset (page/pageSize) com total. Ordenação sempre com desempate por id
 * (paginação estável). Queries: [ids do canal do último touch, se filtrado] + findMany (com
 * campanha/oportunidade/último touch aninhados) + count — sem N+1.
 */
export async function listLeads(params: LeadListParams = {}): Promise<LeadListResult> {
  const { orgId } = await requireProviderOrg();
  const db = scopedPrisma(orgId);
  const p = leadListParamsSchema.parse(params);
  const and: Prisma.LeadWhereInput[] = [];
  if (p.campaignId) and.push({ campaignId: p.campaignId });
  if (p.stage) and.push({ opportunities: { some: { stage: p.stage } } });
  if (p.scoreMin !== undefined || p.scoreMax !== undefined) {
    and.push({ score: { ...(p.scoreMin !== undefined ? { gte: p.scoreMin } : {}), ...(p.scoreMax !== undefined ? { lte: p.scoreMax } : {}) } });
  }
  if (p.q) {
    and.push({
      OR: [
        { name: { contains: p.q, mode: "insensitive" } },
        { email: { contains: p.q, mode: "insensitive" } },
        { company: { contains: p.q, mode: "insensitive" } },
      ],
    });
  }
  if (p.channel) {
    // SPEC-030: $queryRaw não passa pelo scopedPrisma — o filtro de orgId precisa ir explícito no SQL
    // (join até Campaign), senão vaza leadId de outra organização com o mesmo canal.
    const rows = await db.raw.$queryRaw<{ leadId: string }[]>(Prisma.sql`
      SELECT "leadId" FROM (
        SELECT DISTINCT ON (t."leadId") t."leadId", t.channel
        FROM "Touch" t
        JOIN "Lead" l ON l.id = t."leadId"
        JOIN "Campaign" c ON c.id = l."campaignId"
        WHERE c."orgId" = ${orgId}
        ORDER BY t."leadId", t."createdAt" DESC, t.id DESC
      ) t WHERE t.channel = ${p.channel}::"Channel"`);
    and.push({ id: { in: rows.map((r) => r.leadId) } });
  }
  const where: Prisma.LeadWhereInput = and.length ? { AND: and } : {};
  const orderBy: Prisma.LeadOrderByWithRelationInput[] = [{ [p.sort]: p.dir }, { id: "asc" }];

  const [rows, total] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy,
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
      select: {
        id: true,
        name: true,
        company: true,
        email: true,
        phone: true,
        score: true,
        tags: true,
        sequenceStatus: true,
        possibleOptOut: true,
        createdAt: true,
        campaign: { select: { id: true, name: true } },
        opportunities: { select: { id: true, stage: true, value: true }, take: 1 },
        touches: { select: { channel: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
      },
    }),
    db.lead.count({ where }),
  ]);
  const inbound = await getLastInboundByLead(rows.map((r: { id: string }) => r.id));
  const suppressed = await suppressedIds(rows, orgId);
  return {
    items: rows.map((r: (typeof rows)[number]) => ({
      id: r.id,
      name: r.name,
      company: r.company,
      email: r.email,
      phone: r.phone,
      score: r.score,
      tags: r.tags,
      sequenceStatus: r.sequenceStatus,
      createdAt: r.createdAt,
      campaign: r.campaign,
      opportunity: r.opportunities[0] ?? null,
      lastChannel: r.touches[0]?.channel ?? null,
      lastInboundAt: inbound.get(r.id)?.lastInboundAt ?? null,
      lastInboundText: inbound.get(r.id)?.lastInboundText ?? null,
      possibleOptOut: r.possibleOptOut,
      suppressed: suppressed.has(r.id),
    })),
    total,
    page: p.page,
    pageSize: p.pageSize,
    pageCount: Math.max(1, Math.ceil(total / p.pageSize)),
  };
}

export interface LeadTouchItem {
  id: string;
  channel: Channel;
  direction: TouchDirection;
  status: TouchStatus;
  scheduledAt: Date | null;
  sentAt: Date | null;
  repliedAt: Date | null;
  error: string | null;
  content: string | null;
  createdAt: Date;
}

export interface LeadDetail {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  linkedin: string | null;
  source: string | null;
  score: number;
  tags: string[];
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
  campaign: { id: string; name: string };
  sequenceStatus: SequenceStatus;
  currentStepOrder: number;
  nextTouchAt: Date | null;
  repliedAt: Date | null;
  optedOutAt: Date | null;
  /** SPEC-012 (aditivo/opcional). */
  possibleOptOut?: boolean;
  lastInboundAt?: Date | null;
  lastInboundText?: string | null;
  /** SPEC-017 (aditivo/opcional). */
  suppressed?: boolean;
  hasWhatsapp?: boolean | null;
  whatsappCheckedAt?: Date | null;
  opportunity: { id: string; stage: Stage; value: number | null; lostReason: string | null; notes: string | null } | null;
  /** Mais recente primeiro (createdAt desc, id desc). */
  touches: LeadTouchItem[];
  notes: { id: string; body: string; createdAt: Date }[];
  meetings: { id: string; startsAt: Date; duration: number; status: string }[];
}

/** Ficha completa em 1 query (include aninhado, batch do Prisma). null se não existir. */
export async function getLead(id: string): Promise<LeadDetail | null> {
  const { orgId } = await requireProviderOrg();
  const l = await scopedPrisma(orgId).lead.findUnique({
    where: { id },
    include: {
      campaign: { select: { id: true, name: true } },
      opportunities: { select: { id: true, stage: true, value: true, lostReason: true, notes: true }, take: 1 },
      touches: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true, channel: true, direction: true, status: true, scheduledAt: true,
          sentAt: true, repliedAt: true, error: true, content: true, createdAt: true,
        },
      },
      notes: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, body: true, createdAt: true } },
      meetings: {
        orderBy: [{ startsAt: "desc" }, { id: "asc" }],
        select: { id: true, startsAt: true, duration: true, status: true },
      },
    },
  });
  if (!l) return null;
  const { opportunities, rawData: _raw, campaignId: _c, currentStepOrder, ...rest } = l;
  void _raw; void _c;
  const lastIn = l.touches.find((t: LeadTouchItem) => t.direction === "inbound");
  return {
    ...rest,
    currentStepOrder,
    opportunity: opportunities[0] ?? null,
    lastInboundAt: lastIn ? (lastIn.repliedAt ?? lastIn.createdAt) : null,
    lastInboundText: sanitizeInboundText(lastIn?.content),
    suppressed: (await suppressedIds([{ id: l.id, email: l.email, phone: l.phone }], orgId)).has(l.id),
  };
}
