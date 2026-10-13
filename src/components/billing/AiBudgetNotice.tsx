import Link from "next/link";
import { AlertTriangle, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AiBudgetView } from "@/lib/queries/entitlements";
import { UPGRADE_HREF } from "./trial-ui";

const brl = (cents: number): string => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Texto do aviso de teto de IA do plano: 80% (alerta) e 100% (agentes pausados). `null` = sem aviso. PURO. */
export function aiBudgetNoticeText(b: Pick<AiBudgetView, "state" | "spentCents" | "capCents">): { tone: "warn" | "full"; title: string; body: string } | null {
  if (b.capCents === null || b.capCents <= 0) return null;
  const used = `${brl(b.spentCents)} de ${brl(b.capCents)}`;
  if (b.state === "exhausted") {
    return { tone: "full", title: "Teto de IA do mês atingido", body: `Você usou ${used} do teto de IA do seu plano. Os agentes estão pausados até o próximo mês; nada foi apagado. Faça upgrade para liberar mais.` };
  }
  if (b.state === "alert") {
    return { tone: "warn", title: "Teto de IA quase no limite", body: `Você já usou ${used} (80% ou mais) do teto de IA deste mês. Ao chegar em 100%, os agentes pausam automaticamente.` };
  }
  return null;
}

/**
 * SPEC-069d — aviso ao PROPRIETARIO quando o gasto de IA do mes chega a 80% (atencao) e a 100% (agentes pausados). `role="status"` no alerta e
 * `role="alert"` no estouro. Mesmo padrao visual das faixas do layout (HealthBanner/TrialBanner).
 */
export function AiBudgetNotice({ budget, variant = "card", className }: { budget: Pick<AiBudgetView, "state" | "spentCents" | "capCents">; variant?: "card" | "banner"; className?: string }) {
  const n = aiBudgetNoticeText(budget);
  if (!n) return null;
  const Icon = n.tone === "full" ? OctagonAlert : AlertTriangle;
  const tone = n.tone === "full" ? "border-destructive/50 bg-destructive/10" : "border-warning/40 bg-warning/10";
  const iconTone = n.tone === "full" ? "text-destructive" : "text-warning";
  return (
    <div
      role={n.tone === "full" ? "alert" : "status"}
      data-slot="ai-budget-notice"
      className={cn(variant === "banner" ? "flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm md:px-6" : "flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm", tone, className)}
    >
      <Icon className={cn("size-4 shrink-0", variant === "card" && "mt-0.5", iconTone)} aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <strong className="font-medium">{n.title}.</strong> {n.body}
      </p>
      <Link href={UPGRADE_HREF} className="inline-flex min-h-9 items-center rounded-sm font-medium text-foreground underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-primary/40">
        Fazer upgrade
      </Link>
    </div>
  );
}
