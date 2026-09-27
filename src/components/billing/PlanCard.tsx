import type * as React from "react";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PlanView } from "@/lib/billing/plans";
import { CADENCE_LABELS, formatBRLCents, limitLabel, priceForCadence } from "./billing-format";

/**
 * SPEC-034 — card de plano reutilizável (usado em Configurações > Assinatura nesta SPEC; reaproveitado
 * pela landing pública da SPEC-035). Sem lógica de checkout/navegação própria: o CTA é injetado por
 * `footer` (cada consumidor decide se é um `<Button>` de checkout autenticado ou um `<Link>` público
 * para `/signup?plan=...`).
 */
export function PlanCard({
  plan,
  cadence,
  highlighted,
  current,
  footer,
  className,
}: {
  plan: PlanView;
  cadence: "monthly" | "yearly";
  /** Badge "Mais popular" — decisão de destaque de quem monta a grade, não do card. */
  highlighted?: boolean;
  /** "Seu plano atual" — realça a borda e desabilita o CTA por convenção do consumidor. */
  current?: boolean;
  footer: React.ReactNode;
  className?: string;
}) {
  const price = priceForCadence(plan, cadence);
  return (
    <Card
      className={cn(
        "relative flex flex-col gap-4 p-1",
        highlighted && "border-primary/60 shadow-primary/10",
        current && "ring-2 ring-primary/50",
        className,
      )}
    >
      {highlighted && (
        <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2" variant="default">
          Mais popular
        </Badge>
      )}
      <CardHeader className="gap-2 pb-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-heading text-lg font-semibold">{plan.name}</h3>
          {current && <Badge variant="muted">Plano atual</Badge>}
        </div>
        <div className="flex items-baseline gap-1.5">
          {price === null ? (
            <span className="text-2xl font-bold">Sob consulta</span>
          ) : (
            <>
              <span className="text-3xl font-bold tabular-nums">{formatBRLCents(price)}</span>
              <span className="text-sm text-muted-foreground">/ {cadence === "monthly" ? "mês" : "ano"}</span>
            </>
          )}
        </div>
        {price !== null && (
          <p className="text-xs text-muted-foreground">Cobrança {CADENCE_LABELS[cadence].toLowerCase()}{cadence === "yearly" ? " (com desconto)" : ""}.</p>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4 pt-0">
        <ul className="flex-1 space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{limitLabel(plan.limits.maxCampaigns, "campanha(s) ativa(s)")}</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{limitLabel(plan.limits.maxWhatsappInstances, "número(s) de WhatsApp")}</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{limitLabel(plan.limits.maxLeadsPerMonth, "leads/mês")}</span>
          </li>
        </ul>
        {footer}
      </CardContent>
    </Card>
  );
}
