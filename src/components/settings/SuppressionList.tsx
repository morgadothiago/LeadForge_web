"use client";
import * as React from "react";
import Link from "next/link";
import { Eye, EyeOff, Mail, Phone, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/components/leads/lead-format";
import type { SuppressionItem } from "@/lib/queries/suppression";
import { SuppressionRemoveDialog } from "./SuppressionRemoveDialog";
import { SUPPRESSION_KIND_LABELS, maskSuppressedValue, revealSuppressedValue, suppressionReasonLabel } from "./suppression-format";

export function SuppressionList({ items }: { items: SuppressionItem[] }) {
  const [revealed, setRevealed] = React.useState<ReadonlySet<string>>(new Set());
  const [toRemove, setToRemove] = React.useState<SuppressionItem | null>(null);

  const toggle = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <ul className="grid gap-2" aria-label="Contatos suprimidos">
        {items.map((s) => {
          const shown = revealed.has(s.id);
          const Icon = s.kind === "email" ? Mail : Phone;
          const kindLabel = SUPPRESSION_KIND_LABELS[s.kind];
          return (
            <li key={s.id} className="grid gap-2 rounded-lg border border-border bg-card p-3 md:grid-cols-[9rem_minmax(0,1.3fr)_minmax(0,1.3fr)_9rem_auto] md:items-center md:gap-4 md:px-4">
              <Badge variant="muted" className="w-fit">
                <Icon className="size-3.5" aria-hidden="true" /> {kindLabel}
              </Badge>
              <div className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 break-all font-mono text-sm">{shown ? revealSuppressedValue(s.kind, s.value) : maskSuppressedValue(s.kind, s.value)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => toggle(s.id)}
                  aria-pressed={shown}
                  aria-label={shown ? `Ocultar ${kindLabel.toLowerCase()}` : `Revelar ${kindLabel.toLowerCase()} completo`}
                >
                  {shown ? <EyeOff /> : <Eye />}
                </Button>
              </div>
              <div className="min-w-0 text-sm">
                <p>{suppressionReasonLabel(s.reason)}</p>
                {s.note && <p className="break-words text-xs text-muted-foreground">{s.note}</p>}
                {s.leadId && (
                  <Link href={`/leads/${s.leadId}`} className="text-xs text-primary hover:underline">
                    Ver lead
                  </Link>
                )}
              </div>
              <time dateTime={s.createdAt.toISOString()} className="text-xs text-muted-foreground">
                {formatDateTime(s.createdAt)}
              </time>
              <Button variant="outline" size="sm" className="w-fit text-destructive" onClick={() => setToRemove(s)} aria-label={`Remover ${kindLabel.toLowerCase()} ${maskSuppressedValue(s.kind, s.value)} da supressão`}>
                <Trash2 /> Remover
              </Button>
            </li>
          );
        })}
      </ul>
      {toRemove && <SuppressionRemoveDialog item={toRemove} open onOpenChange={(o) => !o && setToRemove(null)} />}
    </>
  );
}
