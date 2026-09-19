"use client";
import * as React from "react";
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoreHorizontal, Pencil } from "lucide-react";
import { ChannelBadge } from "@/components/domain/ChannelBadge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { STAGES, STAGE_LABELS, type ChannelKey } from "@/lib/domain";
import type { BoardCard } from "@/lib/queries/pipeline";
import { cn } from "@/lib/utils";
import { formatBRL } from "./board-state";

export function CardBody({ card, className, linkName = false }: { card: BoardCard; className?: string; linkName?: boolean }) {
  return (
    <div className={cn("min-w-0 flex-1 space-y-2", className)}>
      <div>
        <p className="truncate text-sm font-semibold">
          {linkName ? (
            <Link href={`/leads/${card.lead.id}`} className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40">
              {card.lead.name}
            </Link>
          ) : (
            card.lead.name
          )}
        </p>
        {card.lead.company && <p className="truncate text-xs text-muted-foreground">{card.lead.company}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {card.channel && <ChannelBadge channel={card.channel as ChannelKey} />}
        <span className="rounded-sm bg-muted px-2 py-0.5 text-xs font-medium" title="Score do lead">
          Score {card.lead.score}
        </span>
      </div>
      {card.stage === "perdido" && card.lostReason && (
        <p className="truncate text-xs italic text-muted-foreground" title={card.lostReason}>
          Motivo: {card.lostReason}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground" title={card.campaign.name}>
          {card.campaign.name}
        </span>
        <span className="shrink-0 font-semibold">{card.value != null ? formatBRL(card.value) : "—"}</span>
      </div>
    </div>
  );
}

export function PipelineCard({
  card,
  onMove,
  onEdit,
}: {
  card: BoardCard;
  onMove: (stage: BoardCard["stage"]) => void;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { stage: card.stage },
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-start gap-1 rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-md",
        isDragging && "opacity-50 scale-105",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Arrastar ${card.lead.name}`}
        className="-ml-2 mt-0.5 flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <CardBody card={card} linkName />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" className="-mr-2 -mt-1 size-8" aria-label={`Ações de ${card.lead.name}`} />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <p className="px-2 py-1 text-xs text-muted-foreground">Mover para…</p>
          {STAGES.filter((s) => s !== card.stage).map((s) => (
            <DropdownMenuItem key={s} onClick={() => onMove(s)}>
              {STAGE_LABELS[s]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="size-4" /> Editar valor e notas
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
