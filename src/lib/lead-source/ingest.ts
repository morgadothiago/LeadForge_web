import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { safeErrorForLog } from "@/lib/errors";
import { withSerializableRetry } from "@/lib/db/tx-conflict";
import { createLeadCore } from "@/lib/domain/lead-create";
import { findSuppression } from "@/lib/domain/suppression";
import type { ExtractedContact } from "./mapping";

/**
 * Núcleo de criação de lead compartilhado pelos 2 webhooks da SPEC-041, reaproveitando exatamente a mesma
 * lógica de `createLeadCore`/supressão já usada por `/api/integrations/leads` (SPEC-014). A diferença: aqui
 * `campaignId`/`orgId` NUNCA vêm do payload — sempre resolvidos antes, via `LeadSourceBinding` (D-041-3).
 * Idempotência: dedupe por `WebhookEvent` (mesma tabela de auditoria da SPEC-014), chave = provider + id
 * externo do lead na plataforma de origem (Google `lead_id` / Meta `leadgen_id`) — cada plataforma reenvia
 * a mesma notificação em caso de falha/timeout do lado do anunciante.
 */
export type IngestStatus = "created" | "duplicate" | "suppressed" | "campaign_archived";
export interface IngestResult {
  status: IngestStatus;
  leadId?: string;
}

const eventIdFor = (source: string, externalId: string) => `${source}:${createHash("sha256").update(externalId).digest("hex")}`;

/** Reserva "processing" mais velha que isto é considerada abandonada (processo caiu) e pode ser reassumida (mesmo TTL de SPEC-014). */
export const IDEMPOTENCY_PROCESSING_TTL_MS = 2 * 60_000;

export async function ingestExternalLead(opts: {
  source: "google_ads_leads" | "meta_leads";
  orgId: string;
  campaignId: string;
  externalLeadId: string;
  contact: ExtractedContact;
}): Promise<IngestResult> {
  const { source, orgId, campaignId, externalLeadId, contact } = opts;
  const eventId = eventIdFor(source, externalLeadId);

  // Reivindicação idempotente ANTES de criar o lead: reenvio da mesma notificação nunca duplica.
  try {
    await prisma.webhookEvent.create({ data: { orgId, source, eventId, payload: { state: "processing" } } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const prev = await prisma.webhookEvent.findUnique({ where: { eventId }, select: { payload: true, processedAt: true, createdAt: true } });
      if (!prev) return { status: "duplicate" };
      if (!prev.processedAt) {
        // Reserva abandonada (TTL): reivindicação atômica; só uma repetição simultânea vence (mesmo padrão de SPEC-014).
        if (Date.now() - prev.createdAt.getTime() < IDEMPOTENCY_PROCESSING_TTL_MS) return { status: "duplicate" };
        const won = await prisma.webhookEvent.updateMany({
          where: { eventId, processedAt: null, createdAt: prev.createdAt },
          data: { createdAt: new Date(), payload: { state: "processing" } },
        });
        if (won.count !== 1) return { status: "duplicate" };
      } else {
        const pl = prev.payload as { leadId?: string; status?: IngestStatus } | null;
        return { status: pl?.status ?? "duplicate", ...(pl?.leadId ? { leadId: pl.leadId } : {}) };
      }
    } else {
      throw e;
    }
  }

  try {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
    if (!campaign || campaign.status === "archived") {
      await prisma.webhookEvent.update({ where: { eventId }, data: { payload: { status: "campaign_archived" }, processedAt: new Date() } });
      return { status: "campaign_archived" };
    }

    const dup = await prisma.lead.findFirst({
      where: { campaignId, OR: [...(contact.email ? [{ email: contact.email }] : []), ...(contact.phone ? [{ phone: contact.phone }] : [])] },
      select: { id: true },
    });
    if (dup) {
      await prisma.webhookEvent.update({ where: { eventId }, data: { payload: { status: "duplicate", leadId: dup.id }, processedAt: new Date() } });
      return { status: "duplicate", leadId: dup.id };
    }

    if (await findSuppression({ email: contact.email, phone: contact.phone }, orgId)) {
      await prisma.webhookEvent.update({ where: { eventId }, data: { payload: { status: "suppressed" }, processedAt: new Date() } });
      return { status: "suppressed" };
    }

    const out = await withSerializableRetry(() =>
      prisma.$transaction(
        (tx) =>
          createLeadCore(tx, {
            campaignId,
            name: contact.name,
            company: contact.company,
            email: contact.email,
            phone: contact.phone,
            source,
            rawData: { ...contact.rawData, externalLeadId },
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
    await prisma.webhookEvent.update({ where: { eventId }, data: { payload: { status: "created", leadId: out.id }, processedAt: new Date() } });
    return { status: "created", leadId: out.id };
  } catch (e) {
    // Falha após a reivindicação: libera a chave pra permitir retry do provedor (nunca deixa "processing" preso).
    console.error(`[lead-source/${source}] erro ao processar lead:`, safeErrorForLog(e));
    await prisma.webhookEvent.delete({ where: { eventId } }).catch(() => undefined);
    throw e;
  }
}
