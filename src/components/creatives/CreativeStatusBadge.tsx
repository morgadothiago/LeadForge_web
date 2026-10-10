import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CreativeStatusName } from "@/lib/creatives/types";
import { STATUS_LABEL, STATUS_TONE, type StatusTone } from "./creative-format";

const TONE_CLASS: Partial<Record<StatusTone, string>> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
};

/** SPEC-051b — selo de status (cor + texto: a cor nunca é o único canal). */
export function CreativeStatusBadge({ status, className }: { status: CreativeStatusName; className?: string }) {
  const tone = STATUS_TONE[status];
  const variant = tone === "success" || tone === "warning" ? "muted" : tone;
  return (
    <Badge variant={variant} className={cn(TONE_CLASS[tone], className)}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
