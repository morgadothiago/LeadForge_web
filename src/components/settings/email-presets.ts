export interface ProviderPreset {
  value: string;
  label: string;
  smtpHost: string;
  port: number;
  /** Provedores que exigem senha de app (2FA). */
  appPassword: boolean;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { value: "gmail", label: "Gmail", smtpHost: "smtp.gmail.com", port: 587, appPassword: true },
  { value: "outlook", label: "Outlook / Microsoft 365", smtpHost: "smtp.office365.com", port: 587, appPassword: true },
  { value: "zoho", label: "Zoho Mail", smtpHost: "smtp.zoho.com", port: 587, appPassword: false },
  { value: "outro", label: "Outro", smtpHost: "", port: 587, appPassword: false },
];

export function getPreset(provider: string | null | undefined): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.value === provider) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
}

/** Rótulo legível do provedor salvo (valores desconhecidos aparecem como estão). */
export function providerLabel(provider: string): string {
  return PROVIDER_PRESETS.find((p) => p.value === provider)?.label ?? provider;
}

const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export type VerificationTone = "ok" | "error" | "none";

export function formatVerification(lastVerifiedAt: Date | null, lastError: string | null): { tone: VerificationTone; text: string } {
  if (lastError) return { tone: "error", text: `Erro: ${lastError}` };
  if (lastVerifiedAt) return { tone: "ok", text: `Verificada em ${fmt.format(lastVerifiedAt)}` };
  return { tone: "none", text: "Nunca verificada" };
}
