"use client";
import * as React from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createCheckoutSession } from "@/lib/actions/billing";
import type { PlanView } from "@/lib/billing/plans";
import { PlanCard } from "./PlanCard";

/**
 * SPEC-034 — seleção de plano dentro de Configurações > Assinatura (autenticado). Cobre tanto "escolher
 * um plano" (org sem assinatura ativa) quanto "trocar de plano" (org já assinante: `createCheckoutSession`
 * faz upsert da `Subscription` existente, `src/lib/billing/process-event.ts`) — AMBOS os fluxos passam
 * pelo mesmo botão/checkout hospedado, cumprindo o critério de aceite "troca de plano funciona ponta a
 * ponta até o checkout hospedado".
 */
export function PlanSelectionSection({
  plans,
  currentPlanKey,
  hasSubscription,
  isOwner,
}: {
  plans: PlanView[];
  currentPlanKey: string | null;
  hasSubscription: boolean;
  isOwner: boolean;
}) {
  const [cadence, setCadence] = React.useState<"monthly" | "yearly">("monthly");
  const [loadingKey, setLoadingKey] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function subscribe(planKey: string) {
    setLoadingKey(planKey);
    startTransition(async () => {
      const r = await createCheckoutSession({ planKey, cadence });
      if (r.ok) {
        window.location.href = r.data.url;
        return;
      }
      setLoadingKey(null);
      toast.error(Object.values(r.errors).flat()[0] ?? "Não foi possível iniciar o checkout.");
    });
  }

  return (
    <section aria-labelledby="planos-h" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 id="planos-h" className="font-heading text-base font-semibold">
            {hasSubscription ? "Trocar de plano" : "Escolha um plano"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {hasSubscription ? "Assinar um novo plano substitui o atual imediatamente." : "Comece a assinatura para liberar todos os recursos."}
          </p>
        </div>
        <Tabs value={cadence} onValueChange={(v) => setCadence(v as "monthly" | "yearly")}>
          <TabsList aria-label="Cadência de cobrança">
            <TabsTrigger value="monthly">Mensal</TabsTrigger>
            <TabsTrigger value="yearly">Anual</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {!isOwner && (
        <p role="note" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Somente o proprietário da organização pode assinar ou trocar de plano.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = plan.key === currentPlanKey;
          return (
            <PlanCard
              key={plan.key}
              plan={plan}
              cadence={cadence}
              current={isCurrent}
              highlighted={plan.key === "pro"}
              footer={
                isCurrent ? (
                  <Button variant="secondary" disabled className="w-full">
                    Plano atual
                  </Button>
                ) : !plan.selfServiceCheckout ? (
                  <p className="text-center text-xs text-muted-foreground">Disponível sob consulta comercial.</p>
                ) : (
                  <Button
                    className="w-full"
                    disabled={pending || !isOwner}
                    aria-busy={pending && loadingKey === plan.key}
                    onClick={() => subscribe(plan.key)}
                  >
                    {pending && loadingKey === plan.key && <Loader2 className="animate-spin" aria-hidden="true" />}
                    {hasSubscription ? "Trocar para este plano" : "Assinar"}
                  </Button>
                )
              }
            />
          );
        })}
      </div>
    </section>
  );
}
