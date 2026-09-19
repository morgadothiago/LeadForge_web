import { Badge } from "@/components/ui/badge";
import { CAMPAIGN_STATUS_LABELS } from "@/lib/domain";

export function CampaignStatusBadge({ status }: { status: keyof typeof CAMPAIGN_STATUS_LABELS }) {
  return (
    <Badge variant={status === "active" ? "default" : "muted"}>{CAMPAIGN_STATUS_LABELS[status]}</Badge>
  );
}
