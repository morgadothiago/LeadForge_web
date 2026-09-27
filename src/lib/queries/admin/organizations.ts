import type { OrgStatus, SubscriptionStatus } from "@prisma/client";
import { requirePlatformAdmin } from "@/lib/auth/require-admin";
import { adminPrisma } from "@/lib/tenant/admin-prisma";
import { listOrganizationsSchema, orgIdSchema } from "@/lib/schemas/admin";

/**
 * SPEC-031 — leituras cross-tenant para `platform_admin` (tela SPEC-032). Sempre `requirePlatformAdmin()`
 * + `adminPrisma` (nunca `scopedPrisma`/`requireProviderOrg` — este módulo enxerga TODAS as orgs de
 * propósito). Nenhuma query aqui devolve PII de lead individual, só agregados (ver spec.md "Escopo").
 */

interface OrgCounters {
  activeCampaigns: number;
  totalLeads: number;
  connectedWhatsapp: number;
}

const EMPTY_COUNTERS: OrgCounters = { activeCampaigns: 0, totalLeads: 0, connectedWhatsapp: 0 };

/** 1 rodada de agregação (groupBy/`_count`) para N orgs — evita N+1 ao montar a listagem. */
async function getOrgCounters(orgIds: string[]): Promise<Map<string, OrgCounters>> {
  const counters = new Map<string, OrgCounters>(orgIds.map((id) => [id, { ...EMPTY_COUNTERS }]));
  if (orgIds.length === 0) return counters;
  const [campaignGroups, waGroups, campaigns] = await Promise.all([
    adminPrisma.campaign.groupBy({ by: ["orgId"], where: { orgId: { in: orgIds }, status: "active" }, _count: { _all: true } }),
    adminPrisma.whatsAppInstance.groupBy({ by: ["orgId"], where: { orgId: { in: orgIds }, status: "connected" }, _count: { _all: true } }),
    adminPrisma.campaign.findMany({ where: { orgId: { in: orgIds } }, select: { orgId: true, _count: { select: { leads: true } } } }),
  ]);
  for (const g of campaignGroups) counters.get(g.orgId)!.activeCampaigns = g._count._all;
  for (const g of waGroups) counters.get(g.orgId)!.connectedWhatsapp = g._count._all;
  for (const c of campaigns) counters.get(c.orgId)!.totalLeads += c._count.leads;
  return counters;
}

async function getOwner(orgId: string): Promise<{ name: string; email: string } | null> {
  const membership = await adminPrisma.membership.findFirst({
    where: { orgId, orgRole: "owner" },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { name: true, email: true } } },
  });
  return membership?.user ?? null;
}

export interface OrgListItem extends OrgCounters {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  createdAt: Date;
  ownerName: string | null;
  ownerEmail: string | null;
}

export interface OrgListPage {
  items: OrgListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Lista paginada de todas as Organizations da plataforma. `platform_admin` apenas. */
export async function listOrganizations(input: unknown = {}): Promise<OrgListPage> {
  await requirePlatformAdmin();
  const { page, pageSize, search, status } = listOrganizationsSchema.parse(input ?? {});
  const where = {
    ...(status ? { status } : {}),
    ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { slug: { contains: search, mode: "insensitive" as const } }] } : {}),
  };
  const [total, orgs] = await Promise.all([
    adminPrisma.organization.count({ where }),
    adminPrisma.organization.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        memberships: { where: { orgRole: "owner" }, take: 1, orderBy: { createdAt: "asc" }, select: { user: { select: { name: true, email: true } } } },
      },
    }),
  ]);
  const orgIds = orgs.map((o) => o.id);
  const counters = await getOrgCounters(orgIds);
  return {
    items: orgs.map((o) => {
      const owner = o.memberships[0]?.user ?? null;
      return {
        id: o.id,
        name: o.name,
        slug: o.slug,
        status: o.status,
        createdAt: o.createdAt,
        ownerName: owner?.name ?? null,
        ownerEmail: owner?.email ?? null,
        ...(counters.get(o.id) ?? EMPTY_COUNTERS),
      };
    }),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export interface OrganizationDetail extends OrgCounters {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  createdAt: Date;
  ownerName: string | null;
  ownerEmail: string | null;
  /** Espelha `Organization.status` (SPEC-033 define o mapeamento completo a partir de `Subscription.status`; aqui só o que já existe no schema base). */
  subscriptionStatus: SubscriptionStatus | null;
  /** Instante do `SchedulerRun`/`Touch` mais recente da org (o que for mais novo). null = nunca houve atividade. */
  lastActivityAt: Date | null;
}

/** Detalhe de uma Organization (contadores + assinatura + última atividade). `null` = org inexistente. `platform_admin` apenas. */
export async function getOrganizationDetail(input: unknown): Promise<OrganizationDetail | null> {
  await requirePlatformAdmin();
  const orgId = orgIdSchema.parse(input);
  const org = await adminPrisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, slug: true, status: true, createdAt: true, subscription: { select: { status: true } } },
  });
  if (!org) return null;
  const [counters, owner, lastRun, lastTouch] = await Promise.all([
    getOrgCounters([orgId]),
    getOwner(orgId),
    adminPrisma.schedulerRun.findFirst({ where: { orgId }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    adminPrisma.touch.findFirst({ where: { lead: { campaign: { orgId } } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const lastActivityAt = [lastRun?.startedAt, lastTouch?.createdAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    status: org.status,
    createdAt: org.createdAt,
    ownerName: owner?.name ?? null,
    ownerEmail: owner?.email ?? null,
    subscriptionStatus: org.subscription?.status ?? null,
    lastActivityAt,
    ...(counters.get(orgId) ?? EMPTY_COUNTERS),
  };
}
