import { notifyOrgOwners, absoluteAppUrl } from "@/lib/channels/email/send-once";
import { trialStartedTemplate } from "@/lib/channels/email/templates/trial-started";

/**
 * SPEC-052a — e-mail de inicio do trial, chamado APOS o commit do signup/createOrganization (o trial nasce
 * direto no banco, sem evento de billing). Idempotente por `trial_started:<orgId>` (mesma chave do ramo
 * `trial_started` de `processBillingEvent`). Best-effort: nunca lanca.
 */
export async function sendTrialStartedEmail(orgId: string, planName: string, trialEndsAt: Date): Promise<void> {
  const { subject, html, text } = trialStartedTemplate({ planName, trialEndsAt, link: absoluteAppUrl("/dashboard") });
  await notifyOrgOwners({ orgId, subject, html, text, scenario: "trial_started", dedupeKey: `trial_started:${orgId}` });
}
