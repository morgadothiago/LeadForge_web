import { STAGE_COLORS, STAGE_LABELS, type StageKey } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function StatusBadge({ stage, className }: { stage: StageKey; className?: string }) {
  const color = STAGE_COLORS[stage];
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", className)}
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      {STAGE_LABELS[stage]}
    </span>
  );
}
