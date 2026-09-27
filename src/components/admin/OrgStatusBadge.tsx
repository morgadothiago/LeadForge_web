import type { OrgStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { ORG_STATUS_COLORS, ORG_STATUS_LABELS } from "./org-format";

export function OrgStatusBadge({ status, className }: { status: OrgStatus; className?: string }) {
  const color = ORG_STATUS_COLORS[status];
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", className)}
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      {ORG_STATUS_LABELS[status]}
    </span>
  );
}
