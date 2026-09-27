import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, UnauthorizedError, homeRouteFor } from "@/lib/auth/require-user";
import { listActivePlans } from "@/lib/billing/plans";
import { parseTheme, THEME_COOKIE_NAME } from "@/lib/theme-state";
import { LandingNav } from "@/components/landing/LandingNav";
import { HeroSection } from "@/components/landing/HeroSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { PricingSection } from "@/components/landing/PricingSection";
import { SocialProofSection } from "@/components/landing/SocialProofSection";
import { FinalCtaSection } from "@/components/landing/FinalCtaSection";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { FadeInSection } from "@/components/landing/FadeInSection";

export const metadata: Metadata = {
  title: "LeadForge — Prospecção B2B automatizada com IA",
  description:
    "Campanhas por ICP, sequências multicanal, WhatsApp, busca de leads por IA e agentes de IA (SDR, Follow-up, Closer) num só lugar.",
};
export const dynamic = "force-dynamic";

/**
 * SPEC-035 — landing pública ("/"). Fica fora do grupo `(app)` (que exige `requireUser()` via
 * `(app)/layout.tsx`) de propósito: antes desta SPEC, "/" só existia dentro do grupo autenticado e
 * redirecionava para `/dashboard`. Agora "/" é a própria landing, servida pelo layout raiz
 * (`src/app/layout.tsx`, sem sidebar/header/gate). Usuário já autenticado que acessa "/" continua
 * sendo mandado para `/dashboard` (critério de aceite da SPEC) — checagem abaixo, mesmo padrão de
 * `login/page.tsx` e `signup/page.tsx`.
 *
 * SPEC-037 — a classe isolada `.landing-theme` foi removida: a landing agora usa os mesmos tokens
 * semânticos globais (`bg-background`/`text-foreground`) do resto do app, com variante light/dark.
 */
export default async function Home() {
  let homeRoute: string | null = null;
  try {
    const user = await requireUser();
    homeRoute = homeRouteFor(user.platformRole);
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
  }
  if (homeRoute) redirect(homeRoute);

  const plans = await listActivePlans();
  const initialTheme = parseTheme((await cookies()).get(THEME_COOKIE_NAME)?.value);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <LandingNav initialTheme={initialTheme} />
      <main>
        <HeroSection />
        <FadeInSection>
          <FeaturesSection />
        </FadeInSection>
        <FadeInSection>
          <PricingSection plans={plans} />
        </FadeInSection>
        <FadeInSection>
          <SocialProofSection />
        </FadeInSection>
        <FadeInSection>
          <FinalCtaSection />
        </FadeInSection>
      </main>
      <LandingFooter />
    </div>
  );
}
