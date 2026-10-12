import Link from "next/link";
import { Hourglass } from "lucide-react";
import { UPGRADE_HREF, trialBannerText } from "./trial-ui";

/**
 * SPEC-065b (D-065-24.2) — faixa dos ULTIMOS 3 DIAS do teste gratis (`trial_expirando`). Mesmo padrao visual do
 * `SubscriptionPendingBanner`/`HealthBanner`; tom de aviso (nao de erro: o acesso ainda e total). `role="status"` (anuncio educado).
 */
export function TrialBanner({ daysLeft }: { daysLeft: number }) {
  return (
    <div role="status" data-slot="trial-banner" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm md:px-6">
      <Hourglass className="size-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="min-w-0 flex-1">{trialBannerText(daysLeft)}</p>
      <Link href={UPGRADE_HREF} className="inline-flex min-h-9 items-center rounded-sm font-medium text-foreground underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-primary/40">
        Fazer upgrade
      </Link>
    </div>
  );
}
