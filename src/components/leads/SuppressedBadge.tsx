import { ShieldOff } from "lucide-react";
import { cn } from "@/lib/utils";

/** Lead com contato na lista de supressão: nenhum envio será feito. */
export function SuppressedBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-sm bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive", className)}>
      <ShieldOff className="size-3.5" aria-hidden="true" /> Suprimido — não receberá mensagens
    </span>
  );
}
