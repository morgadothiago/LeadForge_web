import { prisma } from "@/lib/prisma";

/**
 * SPEC-030: o mobile não carrega orgId no token (contrato de auth mantido aditivo/compatível — ver
 * SPEC-030 Riscos); toda leitura/escrita por-org do app resolve a org pela Membership a cada chamada.
 * null = usuário sem org (platform_admin; não deveria usar o app mobile de gestão hoje).
 */
export async function resolveOrgId(userId: string): Promise<string | null> {
  const m = await prisma.membership.findFirst({ where: { userId }, select: { orgId: true } });
  return m?.orgId ?? null;
}
