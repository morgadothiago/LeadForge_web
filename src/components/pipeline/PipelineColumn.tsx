"use client";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { STAGE_COLORS } from "@/lib/domain";
import type { BoardColumn } from "@/lib/queries/pipeline";
import { cn } from "@/lib/utils";
import { formatBRL } from "./board-state";

export function PipelineColumn({ column, children }: { column: BoardColumn; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage });
  const color = STAGE_COLORS[column.stage];
  return (
    <section
      aria-labelledby={`col-${column.stage}`}
      className="flex w-[280px] shrink-0 snap-start flex-col rounded-lg border border-border bg-background md:w-[300px]"
    >
      <header className="space-y-0.5 border-b border-border p-3" style={{ borderTop: `3px solid ${color}` }}>
        <div className="flex items-center justify-between gap-2">
          <h2 id={`col-${column.stage}`} className="flex items-center gap-2 text-sm font-semibold">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: color }} />
            {column.label}
          </h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium" aria-label={`${column.count} oportunidades`}>
            {column.count}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{formatBRL(column.totalValue)}</p>
      </header>
      <SortableContext items={column.cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={cn(
            "m-2 flex min-h-24 flex-1 flex-col gap-2 rounded-lg border-2 border-transparent p-1 transition-colors",
            isOver && "border-dashed border-primary bg-primary/5",
          )}
        >
          {children}
          {column.cards.length === 0 && (
            <li className="flex flex-1 items-center justify-center py-6 text-center text-xs text-muted-foreground">
              Nenhuma oportunidade aqui.
            </li>
          )}
        </ul>
      </SortableContext>
    </section>
  );
}
