/**
 * SPEC-046 (D-046-1) — remetente POR CENÁRIO (não único): cada template tem seu próprio `from`
 * verificado no Resend. Esquema escolhido: 3 env vars agrupando os 5 cenários por "voz" do remetente
 * (mais simples de configurar que 5 envs individuais, sem perder a separação exigida pela decisão):
 *
 * - `RESEND_FROM_NOREPLY` -> `password_reset` (transacional puro, sem resposta esperada).
 * - `RESEND_FROM_SUPPORT` -> `courtesy_welcome` (onboarding feito por um humano do time, admin).
 * - `RESEND_FROM_BILLING` -> `billing_reminder`, `subscription_success`, `subscription_canceled`
 *   (tudo relacionado a cobrança/assinatura sai do mesmo remetente, para o usuário reconhecer o
 *   contexto de cadeia de e-mails de billing).
 *
 * Fallback em cascata, sempre que o env específico do cenário não estiver setado (nunca erro fatal):
 * env do cenário -> `RESEND_FROM_EMAIL` (genérico, opcional) -> `SMTP_USER` -> "no-reply@leadforge.local".
 */
export type EmailScenario = "password_reset" | "courtesy_welcome" | "billing_reminder" | "subscription_success" | "subscription_canceled" | "org_invite" | "trial_started" | "payment_receipt" | "payment_failed" | "payment_recovered" | "renewal_upcoming" | "plan_changed" | "cancel_requested" | "subscription_reactivated" | "account_deletion_confirm" | "account_deletion_requested" | "account_deletion_cancelled" | "account_deleted";

const SCENARIO_ENV_VAR: Record<EmailScenario, string> = {
  password_reset: "RESEND_FROM_NOREPLY",
  courtesy_welcome: "RESEND_FROM_SUPPORT",
  billing_reminder: "RESEND_FROM_BILLING",
  subscription_success: "RESEND_FROM_BILLING",
  subscription_canceled: "RESEND_FROM_BILLING",
  // SPEC-049: convite de organização sai do remetente transacional (noreply).
  org_invite: "RESEND_FROM_NOREPLY",
  // SPEC-052a: e-mails de ciclo de assinatura/cobranca saem do remetente billing.
  trial_started: "RESEND_FROM_BILLING",
  payment_receipt: "RESEND_FROM_BILLING",
  // SPEC-052b: falha/regua, recuperacao, proxima cobranca e troca de plano tambem saem do remetente billing.
  payment_failed: "RESEND_FROM_BILLING",
  payment_recovered: "RESEND_FROM_BILLING",
  renewal_upcoming: "RESEND_FROM_BILLING",
  plan_changed: "RESEND_FROM_BILLING",
  // SPEC-053a: cancelamento agendado e reativacao saem do remetente billing.
  cancel_requested: "RESEND_FROM_BILLING",
  subscription_reactivated: "RESEND_FROM_BILLING",
  // SPEC-054a: exclusao de conta (LGPD) sai do remetente transacional (noreply).
  account_deletion_confirm: "RESEND_FROM_NOREPLY",
  account_deletion_requested: "RESEND_FROM_NOREPLY",
  account_deletion_cancelled: "RESEND_FROM_NOREPLY",
  account_deleted: "RESEND_FROM_NOREPLY",
};

/** SPEC-048 (D-048-5): remetentes do ACS (precisam ser MailFrom do domínio verificado no ACS). */
const ACS_SCENARIO_ENV_VAR: Record<EmailScenario, string> = {
  password_reset: "ACS_FROM_NOREPLY",
  courtesy_welcome: "ACS_FROM_SUPPORT",
  billing_reminder: "ACS_FROM_BILLING",
  subscription_success: "ACS_FROM_BILLING",
  subscription_canceled: "ACS_FROM_BILLING",
  org_invite: "ACS_FROM_NOREPLY",
  trial_started: "ACS_FROM_BILLING",
  payment_receipt: "ACS_FROM_BILLING",
  payment_failed: "ACS_FROM_BILLING",
  payment_recovered: "ACS_FROM_BILLING",
  renewal_upcoming: "ACS_FROM_BILLING",
  plan_changed: "ACS_FROM_BILLING",
  cancel_requested: "ACS_FROM_BILLING",
  subscription_reactivated: "ACS_FROM_BILLING",
  account_deletion_confirm: "ACS_FROM_NOREPLY",
  account_deletion_requested: "ACS_FROM_NOREPLY",
  account_deletion_cancelled: "ACS_FROM_NOREPLY",
  account_deleted: "ACS_FROM_NOREPLY",
};

const DEFAULT_FROM = "no-reply@leadforge.local";

export function fromAddressForScenario(scenario: EmailScenario, env: Record<string, string | undefined> = process.env, providerName?: string): string {
  if (providerName === "acs") {
    const acs = env[ACS_SCENARIO_ENV_VAR[scenario]]?.trim() || env.ACS_FROM_NOREPLY?.trim();
    if (acs) return acs;
  }
  const specific = env[SCENARIO_ENV_VAR[scenario]]?.trim();
  if (specific) return specific;
  const generic = env.RESEND_FROM_EMAIL?.trim();
  if (generic) return generic;
  const smtpUser = env.SMTP_USER?.trim();
  if (smtpUser) return smtpUser;
  return DEFAULT_FROM;
}
