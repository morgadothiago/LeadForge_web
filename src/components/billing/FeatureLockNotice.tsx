import Link from "next/link";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { lockedFeatureText } from "@/lib/billing/plan-ui";
import type { FeatureKey } from "@/lib/billing/plan-catalog";
import { UPGRADE_HREF } from "./trial-ui";

export type LockReason = "plan" | "past_due" | "blocked";

export function featureLockId(feature: string): string {
  return `feature-lock-${feature.replace(/[^a-z0-9]+/gi, "-")}`;
}

/** Texto PURO do bloqueio (testavel): por plano = "<Recurso>: disponível no plano Pro."; por pagamento/bloqueio = regularizar. */
export function featureLockMessage(feature: FeatureKey, reason: LockReason = "plan"): { text: string; cta: string } {
  const t = lockedFeatureText(feature);
  if (reason === "past_due") return { text: `${t.label} está pausado por pagamento em atraso. Regularize a assinatura para voltar.`, cta: "Ver assinatura" };
  if (reason === "blocked") return { text: `${t.label} indisponível: assinatura inativa ou teste encerrado.`, cta: "Ver assinatura" };
  return { text: `${t.label}: ${t.text.charAt(0).toLowerCase()}${t.text.slice(1)}.`, cta: "Fazer upgrade" };
}

/**
 * SPEC-069d (secao E) — explicacao de um recurso que o plano nao inclui (ou pausado por pagamento), com link de upgrade. Nunca some em silencio:
 * o botao bloqueado aponta para este texto por `aria-describedby={featureLockId(feature)}` e fica `aria-disabled`. So UX; a barreira real e o servidor.
 */
export function FeatureLockNotice({ feature, reason = "plan", className, showCta = true, text: override }: { feature: FeatureKey; reason?: LockReason; className?: string; showCta?: boolean; text?: string }) {
  const m = featureLockMessage(feature, reason);
  return (
    <div id={featureLockId(feature)} role="note" data-slot="feature-lock" className={cn("flex flex-wrap items-start gap-x-2 gap-y-1 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm", className)}>
      <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="min-w-0 flex-1">{override ?? m.text}</p>
      {showCta && (
        <Link href={UPGRADE_HREF} className="inline-flex min-h-9 items-center font-medium text-foreground underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-primary/40">
          {m.cta}
        </Link>
      )}
    </div>
  );
}

/** Aviso de politica definida pela plataforma (campo somente leitura do tenant). */
export function PlatformManagedNote({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <p data-slot="platform-managed" className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <Lock className="size-3 shrink-0" aria-hidden="true" />
      {children ?? "Definido pela plataforma"}
    </p>
  );
}
