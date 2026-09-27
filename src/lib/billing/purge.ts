import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { safeErrorForLog } from "@/lib/errors";
import { CANCEL_RETENTION_MS } from "./status-map";

/**
 * SPEC-033 (D-33-4) — job de expurgo/anonimização, 90 dias após cancelamento (mesmo espírito de PII do
 * mobile, D-M6, `web/specs/README.md`). NÃO apaga a org nem o histórico agregado (Campaign/Opportunity/
 * StageHistory seguem intactos para eventual auditoria) — só anonimiza o dado diretamente identificável
 * de CONTATO (Lead PII, corpo das mensagens, notas). `Organization.purgedAt` marca o expurgo (idempotente:
 * reprocessar uma org já expurgada é um no-op, mas o filtro por `purgedAt: null` já evita isso).
 *
 * Chamado automaticamente pelo tick (`run-tick.ts`, isolado — falha nunca derruba o scheduler) e
 * disponível como script manual (`src/scripts/purge-canceled-orgs.ts`).
 */
export interface PurgeResult {
  purged: number;
  errors: number;
}

const ANON_NAME = "Contato removido (expurgo LGPD)";
const ANON_NOTE = "(removido — expurgo LGPD)";

export async function purgeCanceledOrgs(now: Date): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - CANCEL_RETENTION_MS);
  const candidates = await prisma.organization.findMany({
    where: { purgedAt: null, subscription: { status: "canceled", canceledAt: { lte: cutoff } } },
    select: { id: true },
  });

  let purged = 0;
  let errors = 0;
  for (const org of candidates) {
    try {
      // scopedPrisma injeta o filtro de org automaticamente (lead/touch/leadNote são INDIRECT_ORG_MODELS,
      // via campaign) — nunca tocamos em dado de outra org por engano aqui.
      const db = scopedPrisma(org.id);
      await db.lead.updateMany({ data: { name: ANON_NAME, email: null, phone: null, website: null, linkedin: null, rawData: Prisma.DbNull } });
      await db.touch.updateMany({ data: { content: null, subject: null } });
      await db.leadNote.updateMany({ data: { body: ANON_NOTE } });
      await prisma.organization.update({ where: { id: org.id }, data: { purgedAt: now } });
      purged++;
    } catch (e) {
      errors++;
      console.error(`[billing-purge] falha ao expurgar org ${org.id}:`, safeErrorForLog(e));
    }
  }
  return { purged, errors };
}
