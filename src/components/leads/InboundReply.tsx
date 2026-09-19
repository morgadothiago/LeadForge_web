import { MessageSquareReply } from "lucide-react";
import { cn } from "@/lib/utils";
import { truncateInbound, replyLabel } from "./reply-format";

/** "Respondeu <relativo>" + trecho da última mensagem inbound. Sempre texto (React escapa); título com o texto completo. */
export function InboundReply({ at, text, max = 90, className }: { at?: Date | null; text?: string | null; max?: number; className?: string }) {
  if (!at) return null;
  const { relative, absolute } = replyLabel(at);
  return (
    <div className={cn("min-w-0 space-y-0.5 text-xs", className)}>
      <p className="flex items-center gap-1 font-medium text-primary">
        <MessageSquareReply className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          <time dateTime={at.toISOString()} title={absolute} suppressHydrationWarning>
            {relative}
          </time>
        </span>
      </p>
      {text && (
        <p className="truncate text-muted-foreground" title={text}>
          &ldquo;{truncateInbound(text, max)}&rdquo;
        </p>
      )}
    </div>
  );
}
