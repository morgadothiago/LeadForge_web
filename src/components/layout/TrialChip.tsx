import Link from "next/link";
import { Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { UPGRADE_HREF, daysWord, trialChipText } from "@/components/billing/trial-ui";
import { cn } from "@/lib/utils";

/**
 * SPEC-065b (D-065-24.1) — chip "Teste grátis: N dias" + botao "Fazer upgrade" do Header. No celular o chip encolhe para "N d" (rotulo
 * completo para leitor de tela) e o botao some (o proprio chip leva a Assinatura; area de toque >= 44px).
 */
export function TrialChip({ daysLeft, expiring }: { daysLeft: number; expiring: boolean }) {
  return (
    <div className="flex items-center gap-2" data-slot="trial-chip">
      <Link
        href={UPGRADE_HREF}
        aria-label={`${trialChipText(daysLeft)}. Ver assinatura`}
        className={cn(
          "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:min-h-8",
          expiring ? "border-warning/50 bg-warning/10 text-foreground" : "border-primary/30 bg-primary/10 text-foreground",
        )}
      >
        <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline" aria-hidden="true">
          {trialChipText(daysLeft)}
        </span>
        <span className="sm:hidden" aria-hidden="true">
          {daysWord(daysLeft).replace(" dias", " d").replace(" dia", " d")}
        </span>
      </Link>
      <Link href={UPGRADE_HREF} className={cn(buttonVariants({ size: "sm" }), "hidden md:inline-flex")}>
        Fazer upgrade
      </Link>
    </div>
  );
}
