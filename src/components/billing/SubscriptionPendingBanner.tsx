import Link from "next/link";
import { CreditCard } from "lucide-react";
import { getOrgBannerState } from "@/lib/queries/billing";
import { pendingBannerCta, pendingBannerMessage } from "./billing-format";

/**
 * SPEC-034 — faixa persistente quando a org não está `active` (SPEC-033 `status-map.ts`). Mesmo padrão
 * visual de `HealthBanner.tsx`; não esconde o resto da navegação (D-33-4: escrita é barrada nas
 * actions, leitura continua liberada). `getOrgBannerState` lança/devolve `null` para `platform_admin`
 * (sem org) ou qualquer erro de sessão — a faixa simplesmente não aparece, nunca derruba o layout.
 * SPEC-062b: ramo LEGADO "Seu período de teste terminou" (org que estava em trial; nenhuma org nova entra em trial).
 */
export async function SubscriptionPendingBanner() {
  let state: Awaited<ReturnType<typeof getOrgBannerState>> = null;
  try {
    state = await getOrgBannerState();
  } catch {
    return null;
  }
  if (!state || state.status === "active") return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm md:px-6">
      <CreditCard className="size-4 shrink-0 text-destructive" aria-hidden="true" />
      <p className="min-w-0 flex-1">{pendingBannerMessage(state.status, state.trialExpired)}</p>
      <Link
        href="/configuracoes/assinatura"
        className="rounded-sm font-medium text-destructive underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {pendingBannerCta(state.trialExpired)}
      </Link>
    </div>
  );
}
