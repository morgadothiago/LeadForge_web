import { prisma } from "@/lib/prisma";
import { getDummyHash, verifyPassword } from "@/lib/auth/password";
import { SlidingLimiter } from "@/lib/integrations/rate-limit";
import { absoluteAppUrl, sendOnce } from "@/lib/channels/email/send-once";
import { accountDeletionConfirmTemplate } from "@/lib/channels/email/templates/account-deletion-confirm";
import { accountDeletionRequestedTemplate } from "@/lib/channels/email/templates/account-deletion-requested";
import { accountDeletionCancelledTemplate } from "@/lib/channels/email/templates/account-deletion-cancelled";
import { findDeletionBlockers, lockUserOrgs, type DeletionBlocker } from "./blockers";
import { DELETION_CONFIRM_TTL_MS, DELETION_WINDOW_DAYS, DELETION_WINDOW_MS, hashDeletionToken, hashEmail, newDeletionToken } from "./constants";

/**
 * SPEC-054a — fluxo de exclusao de conta: pedido (reautentica com senha) -> confirmacao por link (uso unico, 24h) ->
 * janela de 30 dias (conta bloqueada, sessoes invalidadas) -> purga (`purge.ts`). Cancelar reativa a conta: pelo link do
 * e-mail (token proprio, so hash no banco), pela sessao (pedido ainda nao confirmado) ou com e-mail+senha (janela).
 * Este modulo NAO e "use server": as actions finas ficam em `actions/account-deletion.ts`.
 * E-mails via `sendOnce` (best-effort: falha de provider nunca reverte nem impede o fluxo). Tokens/e-mails nunca em log.
 */

// Rate limits (em memoria, como os demais fluxos; D-049-14 segue valendo para multi-instancia).
const passwordAttemptLimiter = new SlidingLimiter(5, 15 * 60_000); // por usuario: tentativas de senha no pedido
const requestLimiter = new SlidingLimiter(3, 60 * 60_000); // por usuario: pedidos criados por hora
const publicLimiter = new SlidingLimiter(20, 60 * 60_000); // por IP: preview/confirmar/cancelar por token
const credentialCancelByEmailLimiter = new SlidingLimiter(5, 15 * 60_000);
const credentialCancelByIpLimiter = new SlidingLimiter(20, 15 * 60_000);

export function clearAccountDeletionRateLimit(): void {
  for (const l of [passwordAttemptLimiter, requestLimiter, publicLimiter, credentialCancelByEmailLimiter, credentialCancelByIpLimiter]) l.clear();
}
export const publicTokenHit = (ip: string): number => publicLimiter.hit(`ip:${ip}`);
export const credentialCancelHit = (email: string, ip: string): number => Math.max(credentialCancelByEmailLimiter.hit(`email:${email}`), credentialCancelByIpLimiter.hit(`ip:${ip}`));

export const TOKEN_INVALID_MESSAGE = "Link inválido, expirado ou já utilizado.";

export type DeletionStatus = "none" | "awaiting_confirmation" | "scheduled";
export interface DeletionState {
  status: DeletionStatus;
  /** `awaiting_confirmation`: ate quando o link do e-mail vale. */
  confirmationExpiresAt: Date | null;
  /** `scheduled`: quando a exclusao sera executada. */
  scheduledFor: Date | null;
  windowDays: number;
  blockers: DeletionBlocker[];
  /** Pode pedir a exclusao agora (sem bloqueios e sem exclusao agendada). */
  canRequest: boolean;
}

/** Pedido ABERTO do usuario (nao cancelado/executado), o mais recente. */
async function openRequest(userId: string, now: Date) {
  const r = await prisma.accountDeletionRequest.findFirst({
    where: { userId, cancelledAt: null, executedAt: null },
    orderBy: { requestedAt: "desc" },
    select: { id: true, confirmedAt: true, scheduledFor: true, expiresAt: true },
  });
  if (!r) return null;
  if (!r.confirmedAt && r.expiresAt <= now) return null; // nunca confirmado e expirado
  return r;
}

export async function getDeletionState(userId: string, now: Date = new Date()): Promise<DeletionState> {
  const [open, blockers] = await Promise.all([openRequest(userId, now), findDeletionBlockers(prisma, userId)]);
  const status: DeletionStatus = !open ? "none" : open.confirmedAt ? "scheduled" : "awaiting_confirmation";
  return {
    status,
    confirmationExpiresAt: status === "awaiting_confirmation" ? open!.expiresAt : null,
    scheduledFor: status === "scheduled" ? open!.scheduledFor : null,
    windowDays: DELETION_WINDOW_DAYS,
    blockers,
    canRequest: status !== "scheduled" && blockers.length === 0,
  };
}

/** Exclusao CONFIRMADA e ainda nao executada/cancelada (conta bloqueada). Usado pelos logins web/mobile. */
export async function getPendingDeletion(userId: string): Promise<{ scheduledFor: Date } | null> {
  const r = await prisma.accountDeletionRequest.findFirst({
    where: { userId, confirmedAt: { not: null }, cancelledAt: null, executedAt: null },
    orderBy: { requestedAt: "desc" },
    select: { scheduledFor: true },
  });
  return r?.scheduledFor ? { scheduledFor: r.scheduledFor } : null;
}

export type RequestResult =
  | { kind: "ok"; emailSent: boolean; expiresAt: Date }
  | { kind: "bad_password" }
  | { kind: "rate_limited" }
  | { kind: "blocked"; blockers: DeletionBlocker[] }
  | { kind: "already_scheduled"; scheduledFor: Date }
  | { kind: "not_found" };

export async function requestDeletion(userId: string, password: string, now: Date = new Date()): Promise<RequestResult> {
  if (passwordAttemptLimiter.hit(userId) > 0) return { kind: "rate_limited" };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, passwordHash: true } });
  if (!user) return { kind: "not_found" };
  // Reautenticacao: tempo constante (verify sempre roda). Sem senha definida => bloqueio `no_password` logo abaixo.
  const ok = await verifyPassword(user.passwordHash ?? (await getDummyHash()), password);
  if (user.passwordHash && !ok) return { kind: "bad_password" };

  const blockers = await findDeletionBlockers(prisma, userId);
  if (blockers.length) return { kind: "blocked", blockers };
  if (!ok) return { kind: "bad_password" };
  if (requestLimiter.hit(userId) > 0) return { kind: "rate_limited" };

  const open = await openRequest(userId, now);
  if (open?.confirmedAt && open.scheduledFor) return { kind: "already_scheduled", scheduledFor: open.scheduledFor };

  const { token, hash } = newDeletionToken();
  const expiresAt = new Date(now.getTime() + DELETION_CONFIRM_TTL_MS);
  const created = await prisma.$transaction(async (tx) => {
    // Pedido novo substitui os pendentes (nao confirmados): so 1 link valido por vez.
    await tx.accountDeletionRequest.updateMany({ where: { userId, confirmedAt: null, cancelledAt: null, executedAt: null }, data: { cancelledAt: now } });
    return tx.accountDeletionRequest.create({ data: { userId, emailHash: hashEmail(user.email), tokenHash: hash, expiresAt, requestedAt: now }, select: { id: true } });
  });
  const { subject, html, text } = accountDeletionConfirmTemplate({
    link: absoluteAppUrl(`/conta/excluir/${token}`),
    expiresInHours: DELETION_CONFIRM_TTL_MS / 3600_000,
    windowDays: DELETION_WINDOW_DAYS,
  });
  const sent = await sendOnce({ dedupeKey: `account_deletion_confirm:${created.id}`, scenario: "account_deletion_confirm", to: user.email, subject, html, text, userId });
  return { kind: "ok", emailSent: sent === "sent", expiresAt };
}

export type ConfirmResult =
  | { kind: "ok"; userId: string; scheduledFor: Date; emailSent: boolean }
  | { kind: "invalid" }
  | { kind: "blocked"; blockers: DeletionBlocker[] };

class TokenInvalid extends Error {}
class Blocked extends Error {
  constructor(readonly blockers: DeletionBlocker[]) {
    super("blocked");
  }
}

/**
 * Confirma pelo link do e-mail (uso unico, atomico). Agenda `scheduledFor = agora + 30 dias`, bloqueia a conta
 * (sessoes web invalidadas via `sessionsInvalidatedAt`; dispositivos mobile revogados) e envia o e-mail #13.
 * Bloqueio de org (D-054-3) reavaliado SOB lock: se bloquear, o token NAO e consumido (rollback).
 */
export async function confirmDeletion(token: string, now: Date = new Date()): Promise<ConfirmResult> {
  const tokenHash = hashDeletionToken(token);
  const req = await prisma.accountDeletionRequest.findUnique({ where: { tokenHash }, select: { id: true, userId: true } });
  if (!req) return { kind: "invalid" };
  const scheduledFor = new Date(now.getTime() + DELETION_WINDOW_MS);
  const cancel = newDeletionToken();
  let email: string;
  try {
    email = await prisma.$transaction(async (tx) => {
      await lockUserOrgs(tx, req.userId);
      const claim = await tx.accountDeletionRequest.updateMany({
        where: { id: req.id, confirmedAt: null, cancelledAt: null, executedAt: null, expiresAt: { gt: now } },
        data: { confirmedAt: now, scheduledFor, cancelTokenHash: cancel.hash },
      });
      if (claim.count === 0) throw new TokenInvalid();
      const blockers = await findDeletionBlockers(tx, req.userId);
      if (blockers.length) throw new Blocked(blockers);
      const user = await tx.user.update({ where: { id: req.userId }, data: { sessionsInvalidatedAt: now }, select: { email: true } });
      await tx.mobileDevice.updateMany({ where: { userId: req.userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.accountDeletionRequest.updateMany({ where: { userId: req.userId, id: { not: req.id }, confirmedAt: null, cancelledAt: null, executedAt: null }, data: { cancelledAt: now } });
      return user.email;
    });
  } catch (e) {
    if (e instanceof TokenInvalid) return { kind: "invalid" };
    if (e instanceof Blocked) return { kind: "blocked", blockers: e.blockers };
    throw e;
  }
  const { subject, html, text } = accountDeletionRequestedTemplate({ scheduledFor, cancelLink: absoluteAppUrl(`/conta/excluir/cancelar/${cancel.token}`) });
  const sent = await sendOnce({ dedupeKey: `account_deletion_requested:${req.id}`, scenario: "account_deletion_requested", to: email, subject, html, text, userId: req.userId });
  return { kind: "ok", userId: req.userId, scheduledFor, emailSent: sent === "sent" };
}

/** Cancela um pedido aberto (atomico contra a purga: `executedAt`/`cancelledAt` nulos). Se ja estava confirmado, avisa por e-mail (#cancelled). */
async function cancelOpen(req: { id: string; userId: string; confirmedAt: Date | null }, now: Date): Promise<boolean> {
  const r = await prisma.accountDeletionRequest.updateMany({ where: { id: req.id, cancelledAt: null, executedAt: null }, data: { cancelledAt: now } });
  if (r.count === 0) return false;
  if (req.confirmedAt) {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true } });
    if (user) {
      const { subject, html, text } = accountDeletionCancelledTemplate({ loginLink: absoluteAppUrl("/login") });
      await sendOnce({ dedupeKey: `account_deletion_cancelled:${req.id}`, scenario: "account_deletion_cancelled", to: user.email, subject, html, text, userId: req.userId });
    }
  }
  return true;
}

export type CancelResult = { kind: "ok" } | { kind: "invalid" } | { kind: "not_pending" } | { kind: "rate_limited" };

/** Cancela pelo link do e-mail #13 (token proprio de cancelamento). */
export async function cancelDeletionByToken(token: string, now: Date = new Date()): Promise<CancelResult> {
  const req = await prisma.accountDeletionRequest.findUnique({ where: { cancelTokenHash: hashDeletionToken(token) }, select: { id: true, userId: true, confirmedAt: true, cancelledAt: true, executedAt: true } });
  if (!req || !req.confirmedAt || req.cancelledAt || req.executedAt) return { kind: "invalid" };
  return (await cancelOpen(req, now)) ? { kind: "ok" } : { kind: "invalid" };
}

/** Cancela o pedido aberto do usuario LOGADO (na pratica: pedido ainda nao confirmado; apos confirmar as sessoes caem). */
export async function cancelDeletionBySession(userId: string, now: Date = new Date()): Promise<CancelResult> {
  const r = await prisma.accountDeletionRequest.findFirst({
    where: { userId, cancelledAt: null, executedAt: null },
    orderBy: { requestedAt: "desc" },
    select: { id: true, userId: true, confirmedAt: true, expiresAt: true },
  });
  if (!r || (!r.confirmedAt && r.expiresAt <= now)) return { kind: "not_pending" };
  return (await cancelOpen(r, now)) ? { kind: "ok" } : { kind: "not_pending" };
}

/** "Cancelar pelo login" durante a janela: e-mail + senha (login normal fica bloqueado; isto so cancela, nao abre sessao). */
export async function cancelDeletionWithPassword(email: string, password: string, now: Date = new Date()): Promise<CancelResult> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
  const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
  if (!user || !user.passwordHash || !ok) return { kind: "invalid" };
  const r = await prisma.accountDeletionRequest.findFirst({
    where: { userId: user.id, confirmedAt: { not: null }, cancelledAt: null, executedAt: null },
    orderBy: { requestedAt: "desc" },
    select: { id: true, userId: true, confirmedAt: true },
  });
  if (!r) return { kind: "not_pending" };
  return (await cancelOpen(r, now)) ? { kind: "ok" } : { kind: "not_pending" };
}

export type PreviewResult =
  | { valid: false }
  | { valid: true; kind: "confirm"; expiresAt: Date }
  | { valid: true; kind: "cancel"; scheduledFor: Date };

/** Pre-visualizacao (nao consome o token): diz se o link e de confirmar ou de cancelar e ainda vale. */
export async function previewDeletionToken(token: string, now: Date = new Date()): Promise<PreviewResult> {
  const h = hashDeletionToken(token);
  const c = await prisma.accountDeletionRequest.findUnique({ where: { tokenHash: h }, select: { confirmedAt: true, cancelledAt: true, executedAt: true, expiresAt: true } });
  if (c) return !c.confirmedAt && !c.cancelledAt && !c.executedAt && c.expiresAt > now ? { valid: true, kind: "confirm", expiresAt: c.expiresAt } : { valid: false };
  const k = await prisma.accountDeletionRequest.findUnique({ where: { cancelTokenHash: h }, select: { confirmedAt: true, scheduledFor: true, cancelledAt: true, executedAt: true } });
  if (k && k.confirmedAt && k.scheduledFor && !k.cancelledAt && !k.executedAt) return { valid: true, kind: "cancel", scheduledFor: k.scheduledFor };
  return { valid: false };
}
