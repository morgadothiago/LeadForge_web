/**
 * SPEC-065b — "dispensar" os cartoes do dashboard (nome da empresa, primeiros passos). Guardado em cookie (nao localStorage) para o
 * SERVIDOR decidir ja no primeiro HTML (sem piscar/layout shift); mesmo padrao de `theme-state.ts`/`sidebar-state.ts`. Por organizacao.
 */
export type OnboardingCard = "name" | "steps";
export const ONBOARDING_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function onboardingCookieName(card: OnboardingCard, orgId: string): string {
  return `lf_dismiss_${card}_${orgId}`;
}

export function isOnboardingDismissed(value: string | undefined): boolean {
  return value === "1";
}

/** So no cliente. */
export function dismissOnboardingCard(card: OnboardingCard, orgId: string): void {
  document.cookie = `${onboardingCookieName(card, orgId)}=1; path=/; max-age=${ONBOARDING_COOKIE_MAX_AGE}; samesite=lax`;
}
