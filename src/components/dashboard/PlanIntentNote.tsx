import Link from "next/link";
import { Sparkles } from "lucide-react";

/**
 * SPEC-065b (D-065-23) — a pessoa chegou da landing clicando num plano (`/signup?plan=&cadence=`): depois do cadastro o dashboard so
 * LEMBRA o plano e oferece o caminho para o upgrade. Nunca abre o checkout sozinho (o teste gratis comeca antes de pagar).
 */
export function PlanIntentNote({ planName, planKey, cadence }: { planName: string; planKey: string; cadence: "monthly" | "yearly" }) {
  const href = `/configuracoes/assinatura?plan=${encodeURIComponent(planKey)}&cadence=${cadence}#planos`;
  return (
    <div role="note" data-slot="plan-intent" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm">
      <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        Você escolheu o plano <strong className="font-semibold">{planName}</strong>. Aproveite o teste grátis e, quando quiser, faça o upgrade.
      </p>
      <Link href={href} className="inline-flex min-h-9 items-center font-medium text-foreground underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-primary/40">
        Ver plano
      </Link>
    </div>
  );
}
