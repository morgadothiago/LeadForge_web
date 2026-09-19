import { CHANNEL_COLORS, CHANNEL_LABELS, type ChannelKey } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function ChannelBadge({ channel, className }: { channel: ChannelKey; className?: string }) {
  const color = CHANNEL_COLORS[channel];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium", className)}
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {CHANNEL_LABELS[channel]}
    </span>
  );
}
