import { prisma } from "@/lib/prisma";

/**
 * SPEC-030 tornou varreduras como `sweepAlerts`/`runTick` cross-tenant por design: 1 passada por
 * Organization ATIVA do banco. Isso torna testes que contam candidatos/pushes/episódios (não só
 * linhas do próprio org) vulneráveis ao VOLUME de Organizations que outras suites de teste deixam no
 * banco `_test` compartilhado — mesmo escopando toda leitura por `orgId`, um contador GLOBAL (ex.:
 * quantos pushes o adapter fake recebeu nesta varredura) ainda soma o que a varredura gerar para
 * QUALQUER outra org ativa que exista no banco no momento do teste.
 *
 * `parkOtherOrgs` estaciona (suspende) toda org ativa que NÃO seja a(s) informada(s), de forma que a
 * varredura cross-tenant só alcance a própria org do teste — determinístico, independente de quantas
 * fixtures outras suites tenham deixado no banco. `restore()` devolve exatamente as orgs que estavam
 * ativas antes (nunca reativa uma org que o próprio teste suspendeu/apagou de propósito).
 */
export async function parkOtherOrgs(...keepOrgIds: string[]): Promise<{ restore: () => Promise<void> }> {
  const parked = (
    await prisma.organization.findMany({ where: { status: "active", id: { notIn: keepOrgIds } }, select: { id: true } })
  ).map((o) => o.id);
  if (parked.length) await prisma.organization.updateMany({ where: { id: { in: parked } }, data: { status: "suspended" } });
  return {
    restore: async () => {
      if (!parked.length) return;
      await prisma.organization.updateMany({ where: { id: { in: parked } }, data: { status: "active" } });
    },
  };
}
