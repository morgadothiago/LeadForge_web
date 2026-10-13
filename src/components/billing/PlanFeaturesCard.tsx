import Link from "next/link";
import { Check, Lock, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FEATURE_CATALOG, FEATURE_KEYS, type FeatureKey } from "@/lib/billing/plan-catalog";
import { lockedFeatureText } from "@/lib/billing/plan-ui";
import { formatDate } from "@/components/leads/lead-format";
import type { TenantEntitlementsView } from "@/lib/queries/entitlements";

/** `llm.byok` nao e vendido (a IA e da plataforma): fica fora da lista do cliente. */
const HIDDEN: readonly FeatureKey[] = ["llm.byok"];

/** Itens "incluido x bloqueado" a mostrar. PURO (testavel). */
export function featureRows(view: Pick<TenantEntitlementsView, "features">): { key: FeatureKey; label: string; included: boolean; hint: string | null }[] {
  return FEATURE_KEYS.filter((k) => !HIDDEN.includes(k)).map((key) => {
    const included = view.features[key] === true;
    return { key, label: FEATURE_CATALOG[key].label, included, hint: included ? null : lockedFeatureText(key).text };
  });
}

/**
 * SPEC-069d — "O que o seu plano inclui": recursos liberados (plano + ajustes do admin) e os que pedem upgrade, cada um com o nome do plano necessario.
 * Texto sempre presente (nao so icone) para leitor de tela.
 */
export function PlanFeaturesCard({ view }: { view: TenantEntitlementsView }) {
  const rows = featureRows(view);
  return (
    <Card role="region" aria-labelledby="plan-features-title">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle id="plan-features-title">O que o seu plano inclui</CardTitle>
          <p className="text-sm text-muted-foreground">Recursos liberados agora e o que pede um plano maior.</p>
        </div>
        <ShieldCheck className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent className="space-y-3">
        {view.overrideActive && (
          <p role="note" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Sua organização tem ajustes liberados pela plataforma{view.overrideExpiresAt ? ` até ${formatDate(new Date(view.overrideExpiresAt))}` : ""}. Eles já estão contados abaixo.
          </p>
        )}
        {view.paused && (
          <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            IA e envios automáticos estão pausados por pagamento em atraso. Regularize a assinatura para voltar.
          </p>
        )}
        <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {rows.map((r) => (
            <li key={r.key} data-feature={r.key} data-included={r.included} className="flex items-start gap-2 text-sm">
              {r.included ? <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /> : <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className={r.included ? undefined : "text-muted-foreground"}>
                {r.label}
                <span className="sr-only">{r.included ? ": incluído" : ": não incluído"}</span>
                {r.hint && <span className="block text-xs">{r.hint}</span>}
              </span>
            </li>
          ))}
        </ul>
        {rows.some((r) => !r.included) && (
          <p className="text-sm">
            <Link href="#planos" className="font-medium text-primary underline-offset-2 hover:underline">
              Ver planos
            </Link>{" "}
            para liberar o que está bloqueado.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
