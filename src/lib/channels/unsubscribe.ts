import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getEncryptionKey } from "@/lib/env";
import { addSuppression } from "@/lib/domain/suppression";

/**
 * Token de descadastro: `base64url(JSON{l:leadId,e:expEpochSeg}).base64url(HMAC-SHA256)`. Sem PII (só o id opaco do lead).
 * Segredo: derivado de ENCRYPTION_KEY via HMAC(ENCRYPTION_KEY, "leadforge:unsubscribe:v1") — chave separada da usada na cifra.
 * Validade padrão 180 dias. Comparação da assinatura em tempo constante.
 */
export const UNSUBSCRIBE_TTL_SECONDS = 180 * 24 * 3600;

function derivedKey(): Buffer {
  return createHmac("sha256", getEncryptionKey()).update("leadforge:unsubscribe:v1").digest();
}
function sign(body: string): Buffer {
  return createHmac("sha256", derivedKey()).update(body).digest();
}

export function createUnsubscribeToken(leadId: string, now = new Date(), ttlSeconds = UNSUBSCRIBE_TTL_SECONDS): string {
  const body = Buffer.from(JSON.stringify({ l: leadId, e: Math.floor(now.getTime() / 1000) + ttlSeconds })).toString("base64url");
  return `${body}.${sign(body).toString("base64url")}`;
}

/** Devolve o leadId se o token é íntegro e não expirou; senão null (sem detalhe do motivo). */
export function verifyUnsubscribeToken(token: string, now = new Date()): string | null {
  try {
    const [body, sig, extra] = token.split(".");
    if (!body || !sig || extra !== undefined) return null;
    const given = Buffer.from(sig, "base64url");
    const expected = sign(body);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { l?: unknown; e?: unknown };
    if (typeof p.l !== "string" || typeof p.e !== "number") return null;
    if (p.e * 1000 < now.getTime()) return null;
    return p.l;
  } catch {
    return null;
  }
}

export function buildUnsubscribeUrl(leadId: string, now = new Date()): string {
  const base = (process.env.APP_BASE_URL || process.env.AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/api/webhooks/unsubscribe/${createUnsubscribeToken(leadId, now)}`;
}

/** Idempotente: marca opt-out e encerra touches pendentes/agendados como skipped. Devolve false se o lead não existe. */
export async function unsubscribeLead(leadId: string, now = new Date()): Promise<boolean> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, optedOutAt: true, email: true, phone: true, campaign: { select: { orgId: true } } } });
  if (!lead) return false;
  // Lead + touches + supressão (por-org, SPEC-017/030) na MESMA transação: nunca opt-out sem supressão.
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: leadId }, data: { optedOutAt: lead.optedOutAt ?? now, sequenceStatus: "opted_out", nextTouchAt: null } });
    await tx.touch.updateMany({ where: { leadId, direction: "outbound", status: { in: ["pending", "scheduled"] } }, data: { status: "skipped" } });
    await addSuppression(tx, lead.campaign.orgId, { email: lead.email, phone: lead.phone, reason: "opt_out_link", leadId });
  });
  return true;
}
