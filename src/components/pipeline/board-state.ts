import type { BoardCard, BoardColumn } from "@/lib/queries/pipeline";

type Stage = BoardColumn["stage"];

export interface MoveIntent {
  cardId: string;
  toStage: Stage;
  /** Índice na coluna destino já sem o card (mesma semântica do servidor). */
  toIndex: number;
  /** Motivo da perda (só relevante ao mover para perdido). */
  lostReason?: string | null;
}

export function findCard(columns: BoardColumn[], id: string): { card: BoardCard; stage: Stage; index: number } | null {
  for (const col of columns) {
    const index = col.cards.findIndex((c) => c.id === id);
    if (index >= 0) return { card: col.cards[index], stage: col.stage, index };
  }
  return null;
}

function rebuild(col: BoardColumn, cards: BoardCard[]): BoardColumn {
  const reindexed = cards.map((c, i) => (c.position === i && c.stage === col.stage ? c : { ...c, stage: col.stage, position: i }));
  return { ...col, cards: reindexed, count: reindexed.length, totalValue: reindexed.reduce((s, c) => s + (c.value ?? 0), 0) };
}

/** Motivo resultante: só existe em perdido; fora dele é limpo. */
export function nextLostReason(card: BoardCard, intent: MoveIntent): string | null {
  if (intent.toStage !== "perdido") return null;
  if (intent.lostReason === undefined) return card.stage === "perdido" ? (card.lostReason ?? null) : null;
  return intent.lostReason?.trim() || null;
}

/** Exige diálogo de motivo: card vindo de outra coluna para perdido. */
export function needsLostReason(columns: BoardColumn[], intent: MoveIntent): boolean {
  const f = findCard(columns, intent.cardId);
  return !!f && intent.toStage === "perdido" && f.stage !== "perdido";
}

/**
 * Estado otimista após mover um card: remove da origem, insere no destino (toIndex limitado ao fim),
 * reindexa posições 0..n-1 e recalcula contagem/soma. Retorna o mesmo array se for no-op.
 */
export function applyMove(columns: BoardColumn[], intent: MoveIntent): BoardColumn[] {
  const found = findCard(columns, intent.cardId);
  if (!found) return columns;
  const dest = columns.find((c) => c.stage === intent.toStage);
  if (!dest) return columns;
  const without = dest.cards.filter((c) => c.id !== intent.cardId);
  const idx = Math.max(0, Math.min(intent.toIndex, without.length));
  if (found.stage === intent.toStage && found.index === idx) return columns;
  const moved: BoardCard = { ...found.card, stage: intent.toStage, lostReason: nextLostReason(found.card, intent) };
  const inserted = [...without.slice(0, idx), moved, ...without.slice(idx)];
  return columns.map((col) => {
    if (col.stage === intent.toStage) return rebuild(col, inserted);
    if (col.stage === found.stage) return rebuild(col, col.cards.filter((c) => c.id !== intent.cardId));
    return col;
  });
}

/** Resolve o alvo de um drop: sobre uma coluna (fim) ou sobre um card (posição dele). */
export function resolveDrop(columns: BoardColumn[], activeId: string, overId: string): MoveIntent | null {
  const col = columns.find((c) => c.stage === overId);
  if (col) {
    const others = col.cards.filter((c) => c.id !== activeId).length;
    return { cardId: activeId, toStage: col.stage, toIndex: others };
  }
  const over = findCard(columns, overId);
  if (!over || overId === activeId) return null;
  return { cardId: activeId, toStage: over.stage, toIndex: over.index };
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatBRL = (v: number): string => brl.format(v);
