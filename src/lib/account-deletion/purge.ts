import { prisma } from "@/lib/prisma";
import { safeErrorForLog } from "@/lib/errors";
import { sendOnce } from "@/lib/channels/email/send-once";
import { accountDeletedTemplate } from "@/lib/channels/email/templates/account-deleted";
import { recordOrgAudit } from "@/lib/org/audit";
import { revokeOwnerArtifacts } from "@/lib/org/guards";
import { getStorageProvider } from "@/lib/storage/factory";
import { findDeletionBlockers, lockUserOrgs } from "./blockers";
import { ANONYMIZED_NAME, anonymizedEmail } from "./constants";
import { RETAIN_ACCESS_LOGS_MS } from "./retention";

/**
 * SPEC-054a (D-054-1/3/4/5) — execucao da exclusao ao vencer a janela. Roda no tick (isolado; falha nunca derruba o
 * scheduler) e e IDEMPOTENTE: o pedido e "reivindicado" (`executedAt`) atomicamente DENTRO da transacao de anonimizacao;
 * rerodar nao refaz nada nem reenvia o e-mail #14 (alem disso `sendOnce` com chave `account_deleted:<pedidoId>`).
 *
 * O que faz (ver `retention.ts`, fonte unica do texto do e-mail #14):
 * - ANONIMIZA `User` (nome/e-mail/hash de senha/avatar/lastOrgId), mantendo a linha: `Campaign.userId` (Restrict) e a autoria
 *   de campanhas/criativos ficam apontando para o usuario anonimizado (D-054-5, nao reatribui).
 * - APAGA `Membership` (varias orgs: so as memberships), `EmailAccount` (+segredo cifrado), `PasswordResetToken`,
 *   `MobileDevice`/`MobileActionLog`, `EmailDispatchLog` do usuario; `StoredFile` do usuario (soft delete + blob) quando
 *   nao esta em uso por criativo (em uso: so desvincula o autor).
 * - `OrgInvite`/`OrgAuditLog`: ator/alvo nulos; convites enderecados ao e-mail do usuario tem o e-mail anonimizado e sao revogados.
 * - RETEM (anonimizado) `WebhookEvent`/assinatura da org (5 anos; e-mail do usuario redigido dos payloads) e
 *   `IntegrationAuditLog` do usuario por 6 meses (`purgeRetainedUserLogs`).
 * - Org em que o usuario era o UNICO membro: segue o fluxo 053/033 sozinho (assinatura ja cancelada/agendada ->
 *   efetivacao -> 90 dias -> expurgo); nada e reimplementado. Assinatura ativa BLOQUEIA (checado no pedido, na confirmacao e
 *   de novo aqui, sob lock).
 * - Nunca org sem owner: se na hora da purga o usuario virou owner unico de org com outros membros (mudou durante a
 *   janela), a purga e ADIADA (rollback, tenta no proximo tick; 1 log por pedido por processo).
 */
export interface AccountDeletionJobResult {
  executed: number;
  skipped: number;
  blocked: number;
  errors: number;
  emailsSent: number;
  logsPurged: number;
}

class Skipped extends Error {}
class Blocked extends Error {}

const loggedBlocked = new Set<string>();
/** Testes: limpa a memoria de "ja logado" (1 log por pedido bloqueado por processo). */
export function _clearBlockedLog(): void {
  loggedBlocked.clear();
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Outcome = { kind: "executed"; email: string; blobKeys: string[] } | { kind: "skipped" } | { kind: "blocked" };

async function anonymize(reqId: string, now: Date): Promise<Outcome> {
  const req = await prisma.accountDeletionRequest.findUnique({ where: { id: reqId }, select: { userId: true } });
  if (!req) return { kind: "skipped" };
  const userId = req.userId;
  try {
    return await prisma.$transaction(
      async (tx) => {
        await lockUserOrgs(tx, userId);
        const claim = await tx.accountDeletionRequest.updateMany({
          where: { id: reqId, executedAt: null, cancelledAt: null, confirmedAt: { not: null } },
          data: { executedAt: now },
        });
        if (claim.count === 0) throw new Skipped();
        const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
        if (!user) throw new Skipped();
        const orgBlockers = (await findDeletionBlockers(tx, userId)).filter((b) => b.code === "active_subscription" || b.code === "org_without_subscription" || b.code === "last_owner_with_members");
        if (orgBlockers.length) throw new Blocked();
        const email = user.email;
        const emailLower = email.toLowerCase();

        // 1) Memberships (so as do usuario). Owner: revoga convites/codigo ANTES de anular os logs de auditoria.
        const memberships = await tx.membership.findMany({ where: { userId }, select: { id: true, orgId: true, orgRole: true } });
        for (const m of memberships) {
          if (m.orgRole === "owner") await revokeOwnerArtifacts(tx, m.orgId, userId, now);
          await tx.membership.delete({ where: { id: m.id } });
          const remaining = await tx.membership.count({ where: { orgId: m.orgId } });
          if (remaining > 0) await recordOrgAudit(tx, { orgId: m.orgId, actorUserId: null, action: "member_left", targetUserId: null, meta: { reason: "account_deleted" } });
        }
        const orgIds = memberships.map((m) => m.orgId);

        // 2) Dados pessoais apagados.
        await tx.emailAccount.deleteMany({ where: { userId } });
        await tx.passwordResetToken.deleteMany({ where: { userId } });
        await tx.mobileDevice.deleteMany({ where: { userId } });
        await tx.mobileActionLog.deleteMany({ where: { userId } });
        await tx.emailDispatchLog.deleteMany({ where: { userId } });

        // 3) Convites e auditoria: ator/alvo nulos; convites ao e-mail do usuario anonimizados (e revogados se pendentes).
        await tx.orgInvite.updateMany({ where: { createdByUserId: userId }, data: { createdByUserId: null } });
        await tx.orgInvite.updateMany({ where: { usedByUserId: userId }, data: { usedByUserId: null } });
        await tx.orgInvite.updateMany({ where: { email: emailLower, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
        await tx.orgInvite.updateMany({ where: { email: emailLower }, data: { email: anonymizedEmail(userId) } });
        await tx.orgAuditLog.updateMany({ where: { actorUserId: userId }, data: { actorUserId: null } });
        await tx.orgAuditLog.updateMany({ where: { targetUserId: userId }, data: { targetUserId: null } });
        await tx.$executeRaw`UPDATE "OrgAuditLog" SET "meta" = "meta" - 'email' WHERE "meta" IS NOT NULL AND lower("meta"->>'email') = ${emailLower}`;

        // 4) Registros de cobranca da org retidos, mas sem o e-mail do usuario nos payloads (vinculo pessoal anonimizado).
        for (const orgId of orgIds) {
          await tx.$executeRaw`UPDATE "WebhookEvent" SET "payload" = regexp_replace("payload"::text, ${escapeRegex(emailLower)}, '[removido]', 'gi')::jsonb WHERE "orgId" = ${orgId} AND "payload"::text ILIKE ${`%${emailLower}%`}`;
        }

        // 5) Arquivos do usuario: sem uso => soft delete (+ blob apos o commit); em uso por criativo => so desvincula o autor.
        const files = await tx.storedFile.findMany({
          where: { uploadedByUserId: userId },
          select: { id: true, blobKey: true, _count: { select: { creativeVideos: true, creativeThumbnails: true } } },
        });
        const free = files.filter((f) => f._count.creativeVideos + f._count.creativeThumbnails === 0);
        const blobKeys = free.map((f) => f.blobKey);
        if (free.length) await tx.storedFile.updateMany({ where: { id: { in: free.map((f) => f.id) }, deletedAt: null }, data: { deletedAt: now } });
        if (free.length) await tx.storedFile.updateMany({ where: { id: { in: free.map((f) => f.id) } }, data: { originalName: "arquivo-removido" } });
        await tx.storedFile.updateMany({ where: { uploadedByUserId: userId }, data: { uploadedByUserId: null } });

        // 6) User: anonimiza e mantem a linha (D-054-1/5). Sessoes continuam invalidas.
        await tx.user.update({
          where: { id: userId },
          data: { name: ANONYMIZED_NAME, email: anonymizedEmail(userId), passwordHash: null, avatarUrl: null, lastOrgId: null, sessionsInvalidatedAt: now },
        });
        return { kind: "executed", email, blobKeys } as const;
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
  } catch (e) {
    if (e instanceof Skipped) return { kind: "skipped" };
    if (e instanceof Blocked) return { kind: "blocked" };
    throw e;
  }
}

/** Executa UMA exclusao vencida. Exportado para testes. */
export async function executeAccountDeletion(reqId: string, now: Date): Promise<{ outcome: "executed" | "skipped" | "blocked"; emailSent: boolean }> {
  const out = await anonymize(reqId, now);
  if (out.kind !== "executed") {
    if (out.kind === "blocked" && !loggedBlocked.has(reqId)) {
      loggedBlocked.add(reqId);
      console.error(`[account-deletion] purga adiada (organizacao exige acao antes): pedido ${reqId}`);
    }
    return { outcome: out.kind, emailSent: false };
  }
  // Blobs (best-effort): falha deixa o StoredFile soft-deleted para a reconciliacao (`reconcileOrgBlobs`).
  if (out.blobKeys.length) {
    try {
      const provider = getStorageProvider();
      for (const key of out.blobKeys) await provider.delete(key).catch((e) => console.error("[account-deletion] falha ao remover blob (reconciliar):", safeErrorForLog(e)));
    } catch (e) {
      console.error("[account-deletion] storage indisponivel ao remover blobs (reconciliar):", safeErrorForLog(e));
    }
  }
  // #14 ao e-mail ORIGINAL (capturado antes de anonimizar). Sem userId/orgId: a chave sobrevive ao apagamento de logs do usuario.
  const { subject, html, text } = accountDeletedTemplate();
  const sent = await sendOnce({ dedupeKey: `account_deleted:${reqId}`, scenario: "account_deleted", to: out.email, subject, html, text });
  return { outcome: "executed", emailSent: sent === "sent" };
}

/** D-054-4: apaga os logs de auditoria vinculados ao usuario ja excluido apos 6 meses (uma vez por pedido: `logsPurgedAt`). */
export async function purgeRetainedUserLogs(now: Date): Promise<number> {
  const due = await prisma.accountDeletionRequest.findMany({
    where: { executedAt: { lte: new Date(now.getTime() - RETAIN_ACCESS_LOGS_MS) }, logsPurgedAt: null },
    select: { id: true, userId: true },
    take: 200,
  });
  let n = 0;
  for (const r of due) {
    await prisma.$transaction([
      prisma.integrationAuditLog.deleteMany({ where: { userId: r.userId } }),
      prisma.accountDeletionRequest.update({ where: { id: r.id }, data: { logsPurgedAt: now } }),
    ]);
    n++;
  }
  return n;
}

export async function runAccountDeletionJob(now: Date): Promise<AccountDeletionJobResult> {
  const res: AccountDeletionJobResult = { executed: 0, skipped: 0, blocked: 0, errors: 0, emailsSent: 0, logsPurged: 0 };
  const due = await prisma.accountDeletionRequest.findMany({
    where: { confirmedAt: { not: null }, cancelledAt: null, executedAt: null, scheduledFor: { lte: now } },
    select: { id: true },
    orderBy: { scheduledFor: "asc" },
    take: 100,
  });
  for (const r of due) {
    try {
      const o = await executeAccountDeletion(r.id, now);
      if (o.outcome === "executed") res.executed++;
      else if (o.outcome === "blocked") res.blocked++;
      else res.skipped++;
      if (o.emailSent) res.emailsSent++;
    } catch (e) {
      res.errors++;
      console.error(`[account-deletion] falha ao executar exclusao (pedido ${r.id}):`, safeErrorForLog(e));
    }
  }
  try {
    res.logsPurged = await purgeRetainedUserLogs(now);
  } catch (e) {
    res.errors++;
    console.error("[account-deletion] falha ao limpar logs retidos:", safeErrorForLog(e));
  }
  return res;
}
