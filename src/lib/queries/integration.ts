import { prisma } from "@/lib/prisma";
import { requireProviderOrg } from "@/lib/auth/require-admin";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { auditQuerySchema } from "@/lib/schemas/integration";
import { INTEGRATIONS, type IntegrationKindName } from "@/lib/integrations/types";
import { SELECT_ITEM, summarize, toItemView, type IntegrationSummary } from "@/lib/integrations/view";
import type { IntegrationAuditAction } from "@prisma/client";

export const AUDIT_PAGE_SIZE = 20;

/** Uma entrada por integração (sempre as 4). Sem valor cifrado/decifrado; origem env não revela nada do valor. */
export async function listIntegrations(): Promise<IntegrationSummary[]> {
  const { orgId } = await requireProviderOrg();
  const rows = await scopedPrisma(orgId).integrationSecret.findMany({ orderBy: [{ integration: "asc" }, { name: "asc" }], select: SELECT_ITEM });
  const envEvolution = !!process.env.EVOLUTION_API_URL?.trim() && !!process.env.EVOLUTION_API_KEY?.trim();
  return INTEGRATIONS.map((i) =>
    summarize(i, rows.filter((r: { integration: IntegrationKindName }) => r.integration === i).map(toItemView), i === "evolution" && envEvolution),
  );
}

export interface IntegrationAuditEntry {
  id: string;
  userId: string;
  userName: string | null;
  integration: IntegrationKindName;
  action: IntegrationAuditAction;
  hostMasked: string | null;
  allowPrivateHost: boolean | null;
  at: Date;
}
export interface IntegrationAuditPage {
  items: IntegrationAuditEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listIntegrationAudit(input: unknown = {}): Promise<IntegrationAuditPage> {
  const { orgId } = await requireProviderOrg();
  const db = scopedPrisma(orgId);
  const { integration, page } = auditQuerySchema.parse(input ?? {});
  const where = integration ? { integration } : {};
  const [total, rows] = await Promise.all([
    db.integrationAuditLog.count({ where }),
    db.integrationAuditLog.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], skip: (page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE }),
  ]);
  // User não é tenant-scoped (é a própria infra de conta) — busca direta por id é segura aqui (só nomes, sem PII sensível, e os ids já vieram filtrados por orgId acima).
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set<string>(rows.map((r: { userId: string }) => r.userId))] } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    items: rows.map((r: IntegrationAuditEntry) => ({
      id: r.id, userId: r.userId, userName: names.get(r.userId) ?? null, integration: r.integration, action: r.action,
      hostMasked: r.hostMasked, allowPrivateHost: r.allowPrivateHost, at: r.at,
    })),
    page, pageSize: AUDIT_PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
  };
}
