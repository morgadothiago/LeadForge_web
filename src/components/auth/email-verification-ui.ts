import type { FieldErrors } from "@/lib/actions/result";

/** SPEC-055b — helpers puros da UI de verificacao de e-mail. */

export const EMAIL_NOT_VERIFIED_MESSAGE =
  "Confirme seu e-mail para poder enviar mensagens. Use o aviso no topo da tela para reenviar o link de confirmação.";

/** `errors.code[0] === "email_not_verified"` (gate D-055-7 devolvido por approveDraft/dispatch). */
export function isEmailNotVerified(errors: FieldErrors | undefined): boolean {
  return errors?.code?.[0] === "email_not_verified";
}

/** Segundos de espera devolvidos por cooldown/rate_limited (0 se ausente/invalido). */
export function retryAfterSeconds(errors: FieldErrors | undefined): number {
  const n = Number(errors?.retryAfterSeconds?.[0]);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
}

/** Mensagem de falha do reenvio (usa a do servidor; fallback generico). */
export function resendErrorMessage(errors: FieldErrors | undefined): string {
  return errors?._form?.[0] ?? "Não foi possível reenviar o e-mail. Tente novamente em instantes.";
}
