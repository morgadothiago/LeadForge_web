import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AGENT_RETENTION_DAYS } from "./types";

/**
 * Retenção limitada (LGPD): após AGENT_RETENTION_DAYS o conteúdo (resultado estruturado do modelo e corpo dos rascunhos já tratados)
 * é apagado; custo/tokens/status permanecem para métricas. Nenhum AgentRun guarda segredo, telefone ou e-mail.
 */
export async function purgeAgentData(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - AGENT_RETENTION_DAYS * 24 * 3600_000);
  const runs = await prisma.agentRun.updateMany({ where: { createdAt: { lt: cutoff }, result: { not: Prisma.DbNull } }, data: { result: Prisma.DbNull } });
  const drafts = await prisma.draft.updateMany({ where: { createdAt: { lt: cutoff }, status: { not: "pending" }, NOT: { body: "" } }, data: { body: "", editedBody: null } });
  return runs.count + drafts.count;
}
