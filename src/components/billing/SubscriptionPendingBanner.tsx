import Link from "next/link";
import { CreditCard } from "lucide-react";
import { getOrgStatusForBanner } from "@/lib/queries/billing";

/**
 * SPEC-034 — faixa persistente quando a org não está `active` (SPEC-033 `status-map.ts`). Mesmo padrão
 * visual de `HealthBanner.tsx`; não esconde o resto da navegação (D-33-4: escrita é barrada nas
 * actions, leitura continua liberada). `getOrgStatusForBanner` devolve `null` para `platform_admin`
 * (sem org) ou qualquer erro de sessão — a faixa simplesmente não aparece, nunca derruba o layout.
 */
export async function SubscriptionPendingBanner() {
  let status: Awaited<ReturnType<typeof getOrgStatusForBanner>> = null;
  try {
    status = await getOrgStatusForBanner();
  } catch {
    return null;
  }
  if (!status || status === "active") return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm md:px-6">
      <CreditCard className="size-4 shrink-0 text-destructive" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        {status === "cancelled" ? "Sua assinatura foi cancelada." : "Sua assinatura está com o pagamento pendente."} Alguns recursos ficam bloqueados até regularizar.
      </p>
      <Link
        href="/configuracoes/assinatura"
        className="rounded-sm font-medium text-destructive underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Regularizar assinatura
      </Link>
    </div>
  );
}
