import { Clapperboard, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CreativeStatusName } from "@/lib/creatives/types";
import { STATUS_LABEL } from "./creative-format";

/**
 * SPEC-051b — "thumbnail" da biblioteca. O backend não expõe URL de miniatura (mock não gera; sem action de leitura),
 * então é sempre um placeholder com ícone por estado. Decorativo (`aria-hidden`): o status vai em texto no card.
 */
export function CreativeThumb({ status, className }: { status: CreativeStatusName; className?: string }) {
  const Icon = status === "failed" ? TriangleAlert : status === "queued" || status === "processing" ? Loader2 : Clapperboard;
  return (
    <div
      aria-hidden="true"
      data-status={status}
      title={STATUS_LABEL[status]}
      className={cn(
        "flex items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 via-muted to-muted text-muted-foreground",
        status === "failed" && "from-destructive/15 text-destructive",
        className,
      )}
    >
      <Icon className={cn("size-8", (status === "queued" || status === "processing") && "animate-spin")} />
    </div>
  );
}
