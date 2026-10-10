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
export type EmailScenario = "password_reset" | "courtesy_welcome" | "billing_reminder" | "subscription_success" | "subscription_canceled" | "org_invite";

const SCENARIO_ENV_VAR: Record<EmailScenario, string> = {
  password_reset: "RESEND_FROM_NOREPLY",
  courtesy_welcome: "RESEND_FROM_SUPPORT",
  billing_reminder: "RESEND_FROM_BILLING",
  subscription_success: "RESEND_FROM_BILLING",
  subscription_canceled: "RESEND_FROM_BILLING",
  // SPEC-049: convite de organização sai do remetente transacional (noreply).
  org_invite: "RESEND_FROM_NOREPLY",
};

/** SPEC-048 (D-048-5): remetentes do ACS (precisam ser MailFrom do domínio verificado no ACS). */
const ACS_SCENARIO_ENV_VAR: Record<EmailScenario, string> = {
  password_reset: "ACS_FROM_NOREPLY",
  courtesy_welcome: "ACS_FROM_SUPPORT",
  billing_reminder: "ACS_FROM_BILLING",
  subscription_success: "ACS_FROM_BILLING",
  subscription_canceled: "ACS_FROM_BILLING",
  org_invite: "ACS_FROM_NOREPLY",
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
