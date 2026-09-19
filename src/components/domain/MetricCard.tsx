import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TrendDirection } from "@/lib/queries/dashboard";

/** Direção efetiva: explícita quando informada; senão derivada do sinal (0 => flat). */
export function resolveDirection(trend: number, direction?: TrendDirection): TrendDirection {
  if (direction) return direction;
  return trend > 0 ? "up" : trend < 0 ? "down" : "flat";
}

export function MetricCard({
  title,
  value,
  trend,
  direction,
  className,
}: {
  title: string;
  value: string | number;
  /** variação percentual; positivo = verde, negativo = vermelho; null = sem base de comparação ("—") */
  trend?: number | null;
  /** direção da tendência; "flat" renderiza neutro (cinza, sem seta verde) */
  direction?: TrendDirection;
  className?: string;
}) {
  const dir = resolveDirection(trend ?? 0, direction);
  return (
    <Card className={cn("hover-lift p-5", className)}>
      <p className="text-[13px] text-muted-foreground">{title}</p>
      <p className="mt-1 font-heading text-[28px] font-bold leading-tight">{value}</p>
      {trend === null && (
        <p className="mt-2 text-xs font-medium text-muted-foreground" aria-label="Sem base de comparação">
          —
        </p>
      )}
      {trend !== undefined && trend !== null && (
        <p
          className={cn(
            "mt-2 inline-flex items-center gap-1 text-xs font-medium",
            dir === "up" && "text-[#22c55e]",
            dir === "down" && "text-destructive",
            dir === "flat" && "text-muted-foreground",
          )}
        >
          {dir === "up" && <ArrowUpRight className="size-3.5" />}
          {dir === "down" && <ArrowDownRight className="size-3.5" />}
          {dir === "flat" && <Minus className="size-3.5" />}
          {Math.abs(trend)}%
        </p>
      )}
    </Card>
  );
}
