"use server";

import { headers } from "next/headers";
import { requireProviderOrg } from "@/lib/auth/require-admin";
import { requireUser } from "@/lib/auth/require-user";
import { destroySession, getSession } from "@/lib/auth/session";
import { getClientIpKey } from "@/lib/auth/client-ip";
import {
  cancelDeletionBySession,
  cancelDeletionByToken,
  cancelDeletionWithPassword,
  confirmDeletion,
  credentialCancelHit,
  getDeletionState,
  previewDeletionToken,
  publicTokenHit,
  requestDeletion,
  TOKEN_INVALID_MESSAGE,
  type DeletionState,
} from "@/lib/account-deletion/service";
import type { DeletionBlocker } from "@/lib/account-deletion/blockers";
import { DELETION_WINDOW_DAYS } from "@/lib/account-deletion/constants";
import {
  accountDeletionTokenSchema,
  cancelAccountDeletionWithPasswordSchema,
  requestAccountDeletionSchema,
} from "@/lib/schemas/account-deletion";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

/**
 * SPEC-054a — actions de exclusao de conta (contrato para o frontend 054b; documentado na SPEC).
 * Erros tipados: alem de `_form` (mensagem PT-BR), `code` carrega um codigo estavel (`blocked`, `already_scheduled`, ...) e,
 * quando `blocked`, `blockers` carrega os codigos (`active_subscription` | `last_owner_with_members` | ...).
 */
const TOO_MANY = "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
const BAD_PASSWORD = "Senha incorreta.";

const ip = async (): Promise<string> => getClientIpKey(await headers());

function blockedError<T>(blockers: DeletionBlocker[]): ActionResult<T> {
  return { ok: false, errors: { _form: blockers.map((b) => b.message), code: ["blocked"], blockers: blockers.map((b) => b.code) } };
}
function coded<T>(code: string, message: string, extra: Record<string, string[]> = {}): ActionResult<T> {
  return { ok: false, errors: { _form: [message], code: [code], ...extra } };
}

/** Estado da exclusao do usuario logado + bloqueios tipados. Qualquer papel; nao exige org ativa (so sessao de provider). */
export async function getAccountDeletionState(): Promise<ActionResult<DeletionState>> {
  return safeAction(async () => {
    const { user } = await requireProviderOrg();
    return success(await getDeletionState(user.id));
  });
}

/** Passo 1: reautentica com a senha e envia o e-mail de confirmacao (link `/conta/excluir/<token>`). */
export async function requestAccountDeletion(input: unknown): Promise<ActionResult<{ emailSent: boolean; expiresAt: Date }>> {
  return safeAction(async () => {
    const { user } = await requireProviderOrg();
    const parsed = requestAccountDeletionSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const r = await requestDeletion(user.id, parsed.data.password);
    switch (r.kind) {
      case "ok":
        return success({ emailSent: r.emailSent, expiresAt: r.expiresAt });
      case "bad_password":
        return failure({ password: [BAD_PASSWORD] });
      case "rate_limited":
        return coded("rate_limited", TOO_MANY);
      case "blocked":
        return blockedError(r.blockers);
      case "already_scheduled":
        return coded("already_scheduled", "A exclusão da sua conta já está agendada.", { scheduledFor: [r.scheduledFor.toISOString()] });
      default:
        return formError("Não foi possível iniciar a exclusão da conta.");
    }
  });
}

/** Cancela o pedido do usuario LOGADO (pedido ainda nao confirmado; apos confirmar as sessoes sao encerradas). */
export async function cancelAccountDeletion(): Promise<ActionResult<{ cancelled: true }>> {
  return safeAction(async () => {
    const user = await requireUser();
    const r = await cancelDeletionBySession(user.id);
    if (r.kind === "ok") return success({ cancelled: true as const });
    return coded("not_pending", "Não há exclusão em andamento para cancelar.");
  });
}

/** PUBLICA (token e a prova): diz se o link e de confirmar ou cancelar e se ainda vale, sem consumir. */
export async function previewAccountDeletionToken(
  input: unknown,
): Promise<ActionResult<{ valid: false } | { valid: true; kind: "confirm"; expiresAt: Date } | { valid: true; kind: "cancel"; scheduledFor: Date }>> {
  return safeAction(async () => {
    if (publicTokenHit(await ip()) > 0) return coded("rate_limited", TOO_MANY);
    const parsed = accountDeletionTokenSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    return success(await previewDeletionToken(parsed.data.token));
  });
}

/**
 * Passo 2 (PUBLICA, link do e-mail): confirma (uso unico), agenda a exclusao em 30 dias, bloqueia a conta, encerra a
 * sessao deste navegador se for do mesmo usuario e envia o e-mail "solicitacao recebida".
 */
export async function confirmAccountDeletion(input: unknown): Promise<ActionResult<{ scheduledFor: Date; windowDays: number }>> {
  return safeAction(async () => {
    if (publicTokenHit(await ip()) > 0) return coded("rate_limited", TOO_MANY);
    const parsed = accountDeletionTokenSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const r = await confirmDeletion(parsed.data.token);
    if (r.kind === "invalid") return coded("token_invalid", TOKEN_INVALID_MESSAGE);
    if (r.kind === "blocked") return blockedError(r.blockers);
    const session = await getSession();
    if (session?.userId === r.userId) await destroySession();
    return success({ scheduledFor: r.scheduledFor, windowDays: DELETION_WINDOW_DAYS });
  });
}

/** PUBLICA (link de cancelamento do e-mail #13): cancela a exclusao agendada e reativa a conta. */
export async function cancelAccountDeletionByToken(input: unknown): Promise<ActionResult<{ cancelled: true }>> {
  return safeAction(async () => {
    if (publicTokenHit(await ip()) > 0) return coded("rate_limited", TOO_MANY);
    const parsed = accountDeletionTokenSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const r = await cancelDeletionByToken(parsed.data.token);
    return r.kind === "ok" ? success({ cancelled: true as const }) : coded("token_invalid", TOKEN_INVALID_MESSAGE);
  });
}

/**
 * PUBLICA ("cancelar pelo login"): durante a janela o login normal responde `account_deletion_pending`; esta action recebe
 * e-mail+senha, cancela a exclusao e reativa a conta (nao abre sessao: o usuario entra pelo login em seguida).
 */
export async function cancelAccountDeletionWithPassword(input: unknown): Promise<ActionResult<{ cancelled: true }>> {
  return safeAction(async () => {
    const parsed = cancelAccountDeletionWithPasswordSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    if (credentialCancelHit(parsed.data.email, await ip()) > 0) return coded("rate_limited", TOO_MANY);
    const r = await cancelDeletionWithPassword(parsed.data.email, parsed.data.password);
    if (r.kind === "ok") return success({ cancelled: true as const });
    if (r.kind === "not_pending") return coded("not_pending", "Não há exclusão agendada para esta conta.");
    return formError("E-mail ou senha inválidos.");
  });
}
