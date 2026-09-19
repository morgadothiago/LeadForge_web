"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { toast } from "sonner";
import { moveOpportunity } from "@/lib/actions/pipeline";
import { STAGE_LABELS } from "@/lib/domain";
import type { BoardCard, BoardColumn } from "@/lib/queries/pipeline";
import { EditOpportunityDialog } from "./EditOpportunityDialog";
import { CardBody, PipelineCard } from "./PipelineCard";
import { PipelineColumn } from "./PipelineColumn";
import { LostReasonDialog } from "./LostReasonDialog";
import { applyMove, findCard, needsLostReason, resolveDrop, type MoveIntent } from "./board-state";

type Stage = BoardCard["stage"];

const instructions =
  "Para mover, pressione espaço no botão de arrastar, use as setas para escolher a posição, espaço para soltar ou Esc para cancelar.";

export function PipelineBoard({ columns: serverColumns, campaignId }: { columns: BoardColumn[]; campaignId?: string }) {
  const router = useRouter();
  const [columns, setColumns] = React.useState(serverColumns);
  const [prevServer, setPrevServer] = React.useState(serverColumns);
  if (prevServer !== serverColumns) {
    setPrevServer(serverColumns);
    setColumns(serverColumns);
  }
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<BoardCard | null>(null);
  const [pendingLoss, setPendingLoss] = React.useState<MoveIntent | null>(null);
  const [, startTransition] = React.useTransition();
  const columnsRef = React.useRef(columns);
  React.useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const commit = React.useCallback(
    (intent: MoveIntent) => {
      const prev = columnsRef.current;
      const next = applyMove(prev, intent);
      if (next === prev) return;
      setColumns(next);
      startTransition(async () => {
        const r = await moveOpportunity({
          opportunityId: intent.cardId,
          toStage: intent.toStage,
          toIndex: intent.toIndex,
          ...(intent.toStage === "perdido" && intent.lostReason !== undefined ? { lostReason: intent.lostReason } : {}),
          ...(campaignId ? { campaignId } : {}),
        });
        if (r.ok) {
          if (r.data.changed && (intent.toStage === "fechado" || intent.toStage === "perdido")) {
            toast.success(intent.toStage === "perdido" ? "Oportunidade perdida." : "Oportunidade fechada.", {
              description: "Sequência automática encerrada.",
            });
          }
        } else {
          setColumns(prev);
          toast.error(r.errors._form?.[0] ?? Object.values(r.errors).flat()[0] ?? "Não foi possível mover a oportunidade.");
          router.refresh();
        }
        // changed:false => servidor já estava nesse estado; nada a reverter nem revalidar.
      });
    },
    [campaignId, router],
  );

  const request = React.useCallback(
    (intent: MoveIntent) => {
      if (needsLostReason(columnsRef.current, intent)) setPendingLoss(intent);
      else commit(intent);
    },
    [commit],
  );

  const nameOf = (id: string | number): string => {
    const f = findCard(columnsRef.current, String(id));
    return f ? f.card.lead.name : "Oportunidade";
  };
  const stageOf = (id: string | number): string | null => {
    const col = columnsRef.current.find((c) => c.stage === id);
    if (col) return STAGE_LABELS[col.stage];
    const f = findCard(columnsRef.current, String(id));
    return f ? STAGE_LABELS[f.stage] : null;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${nameOf(active.id)} selecionado. ${instructions}`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} sobre ${stageOf(over.id) ?? "outra posição"}.` : `${nameOf(active.id)} fora de qualquer coluna.`),
    onDragEnd: ({ active, over }) => (over ? `${nameOf(active.id)} solto em ${stageOf(over.id) ?? "nova posição"}.` : `${nameOf(active.id)} solto fora de uma coluna. Nada foi alterado.`),
    onDragCancel: ({ active }) => `Movimento cancelado. ${nameOf(active.id)} voltou à posição original.`,
  };

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    if (!e.over) return;
    const intent = resolveDrop(columnsRef.current, String(e.active.id), String(e.over.id));
    if (intent) request(intent);
  }

  const active = activeId ? findCard(columns, activeId)?.card : undefined;
  const total = columns.reduce((s, c) => s + c.count, 0);

  return (
    <>
      {total === 0 && (
        <p className="mb-3 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground" role="status">
          Nenhuma oportunidade encontrada. Ajuste os filtros ou a busca.
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        accessibility={{ announcements, screenReaderInstructions: { draggable: instructions } }}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:snap-none md:px-0">
          {columns.map((col) => (
            <PipelineColumn key={col.stage} column={col}>
              {col.cards.map((card) => (
                <PipelineCard
                  key={card.id}
                  card={card}
                  onMove={(stage: Stage) => request({ cardId: card.id, toStage: stage, toIndex: Number.MAX_SAFE_INTEGER })}
                  onEdit={() => setEditing(card)}
                />
              ))}
            </PipelineColumn>
          ))}
        </div>
        <DragOverlay>
          {active ? (
            <div className="flex scale-105 rounded-lg border border-primary bg-card p-4 pl-8 opacity-90 shadow-xl">
              <CardBody card={active} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {pendingLoss && (
        <LostReasonDialog
          leadName={findCard(columns, pendingLoss.cardId)?.card.lead.name ?? "Oportunidade"}
          onCancel={() => setPendingLoss(null)}
          onConfirm={(reason) => {
            const intent = { ...pendingLoss, lostReason: reason };
            setPendingLoss(null);
            commit(intent);
          }}
        />
      )}
      {editing && (
        <EditOpportunityDialog
          key={editing.id}
          card={editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={(patch) => {
            const id = editing.id;
            setColumns((cols) =>
              cols.map((c) => {
                if (!c.cards.some((k) => k.id === id)) return c;
                const cards = c.cards.map((k) => (k.id === id ? { ...k, ...patch } : k));
                return { ...c, cards, totalValue: cards.reduce((s, k) => s + (k.value ?? 0), 0) };
              }),
            );
          }}
        />
      )}
    </>
  );
}
