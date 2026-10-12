import Link from "next/link";
import { Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { isAtLimit, usageRatio, usageText, usageTone, type UsageItem } from "./trial-ui";

const BAR_TONE = { ok: "bg-primary", warn: "bg-warning", full: "bg-destructive" } as const;

/**
 * SPEC-065b (D-065-18, "medidor") — uso x limite do plano em Configuracoes > Assinatura. Cada linha e um `role="progressbar"` com
 * rotulo, "1 de 1" em texto (nao depende so de cor: o estado cheio tambem diz "Limite atingido") e barra. Ilimitado = so o numero.
 * Os dados vem de `getPlanUsage` (so leitura); a barreira real dos limites e o backend (065a).
 */
export function UsageMeter({ items, trialing }: { items: UsageItem[]; trialing: boolean }) {
  const anyFull = items.some(isAtLimit);
  return (
    <Card role="region" aria-labelledby="usage-meter-title">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle id="usage-meter-title">Uso do plano</CardTitle>
          <p className="text-sm text-muted-foreground">
            {trialing ? "Durante o teste grátis valem estes limites. Ao assinar, os limites do plano escolhido passam a valer na hora." : "Quanto do seu plano você já usou."}
          </p>
        </div>
        <Gauge className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-4">
          {items.map((item) => {
            const tone = usageTone(item);
            const full = isAtLimit(item);
            const labelId = `usage-${item.metric}`;
            return (
              <li key={item.metric} data-metric={item.metric} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p id={labelId} className="text-sm font-medium">
                    {item.label} <span className="font-normal text-muted-foreground">({item.scope})</span>
                  </p>
                  <p className={cn("text-sm tabular-nums", full ? "font-semibold text-destructive" : "text-muted-foreground")}>
                    {usageText(item)}
                    {full && <span className="ml-1.5">· Limite atingido</span>}
                  </p>
                </div>
                {item.limit !== null && (
                  <div
                    role="progressbar"
                    aria-labelledby={labelId}
                    aria-valuemin={0}
                    aria-valuemax={item.limit}
                    aria-valuenow={Math.min(item.used, item.limit)}
                    aria-valuetext={usageText(item)}
                    className="h-2 w-full overflow-hidden rounded-full bg-muted"
                  >
                    <div className={cn("h-full rounded-full transition-[width]", BAR_TONE[tone])} style={{ width: `${Math.round(usageRatio(item) * 100)}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {trialing && (
          <p className="text-xs text-muted-foreground">
            No WhatsApp, o aquecimento do número limita os envios nos primeiros dias, mesmo dentro do limite do plano. É uma proteção contra bloqueio do seu número.
          </p>
        )}
        {anyFull && (
          <p className="text-sm">
            Chegou no limite?{" "}
            <Link href="#planos" className="font-medium text-primary underline-offset-2 hover:underline">
              Veja os planos
            </Link>{" "}
            para liberar mais espaço.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
