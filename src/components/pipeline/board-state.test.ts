import { describe, expect, it } from "vitest";
import type { BoardCard, BoardColumn } from "@/lib/queries/pipeline";
import { applyMove, formatBRL, needsLostReason, resolveDrop } from "./board-state";

const card = (id: string, stage: BoardCard["stage"], position: number, value: number | null): BoardCard => ({
  id, stage, position, value, notes: null,
  lead: { id: `l${id}`, name: id, company: null, score: 1 },
  channel: null, campaign: { id: "c", name: "C" },
});
const col = (stage: BoardColumn["stage"], cards: BoardCard[]): BoardColumn => ({
  stage, label: stage, count: cards.length, totalValue: cards.reduce((s, c) => s + (c.value ?? 0), 0), cards,
});
const board = (): BoardColumn[] => [
  col("novo_lead", [card("a", "novo_lead", 0, 100), card("b", "novo_lead", 1, 50), card("c", "novo_lead", 2, null)]),
  col("contactado", [card("d", "contactado", 0, 10)]),
  col("perdido", []),
  col("fechado", []),
];

describe("applyMove", () => {
  it("move entre colunas, reindexa e recalcula totais", () => {
    const r = applyMove(board(), { cardId: "a", toStage: "contactado", toIndex: 0 });
    expect(r[0].cards.map((c) => [c.id, c.position])).toEqual([["b", 0], ["c", 1]]);
    expect(r[1].cards.map((c) => [c.id, c.position, c.stage])).toEqual([["a", 0, "contactado"], ["d", 1, "contactado"]]);
    expect([r[0].count, r[0].totalValue, r[1].count, r[1].totalValue]).toEqual([2, 50, 2, 110]);
  });
  it("reordena na mesma coluna", () => {
    const r = applyMove(board(), { cardId: "a", toStage: "novo_lead", toIndex: 2 });
    expect(r[0].cards.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });
  it("no-op devolve a mesma referência", () => {
    const b = board();
    expect(applyMove(b, { cardId: "b", toStage: "novo_lead", toIndex: 1 })).toBe(b);
  });
  it("limita toIndex ao fim e ignora id inexistente", () => {
    const r = applyMove(board(), { cardId: "a", toStage: "contactado", toIndex: 99 });
    expect(r[1].cards.map((c) => c.id)).toEqual(["d", "a"]);
    const b = board();
    expect(applyMove(b, { cardId: "zz", toStage: "contactado", toIndex: 0 })).toBe(b);
  });
  it("não muta a entrada", () => {
    const b = board();
    applyMove(b, { cardId: "a", toStage: "contactado", toIndex: 0 });
    expect(b[0].cards).toHaveLength(3);
  });
});

describe("resolveDrop", () => {
  it("sobre coluna vai ao fim; sobre card usa o índice dele", () => {
    expect(resolveDrop(board(), "a", "contactado")).toEqual({ cardId: "a", toStage: "contactado", toIndex: 1 });
    expect(resolveDrop(board(), "a", "novo_lead")).toEqual({ cardId: "a", toStage: "novo_lead", toIndex: 2 });
    expect(resolveDrop(board(), "a", "c")).toEqual({ cardId: "a", toStage: "novo_lead", toIndex: 2 });
    expect(resolveDrop(board(), "a", "a")).toBeNull();
  });
});

describe("formatBRL", () => {
  it("formata em reais", () => {
    expect(formatBRL(1234.5).replace(/\s/g, " ")).toBe("R$ 1.234,50");
  });
});

describe("motivo de perda", () => {
  it("grava motivo (trim) ao mover para perdido e limpa ao sair", () => {
    const b = board();
    const first = b.flatMap((c) => c.cards)[0];
    const lost = applyMove(b, { cardId: first.id, toStage: "perdido", toIndex: 99, lostReason: "  caro  " });
    const inLost = lost.find((c) => c.stage === "perdido")!.cards.find((c) => c.id === first.id)!;
    expect(inLost.lostReason).toBe("caro");
    const back = applyMove(lost, { cardId: first.id, toStage: "novo_lead", toIndex: 0 });
    expect(back.flatMap((c) => c.cards).find((c) => c.id === first.id)!.lostReason).toBeNull();
  });
  it("motivo vazio vira null e needsLostReason só fora de perdido", () => {
    const b = board();
    const first = b.flatMap((c) => c.cards)[0];
    expect(needsLostReason(b, { cardId: first.id, toStage: "perdido", toIndex: 0 })).toBe(true);
    expect(needsLostReason(b, { cardId: first.id, toStage: "fechado", toIndex: 0 })).toBe(false);
    const lost = applyMove(b, { cardId: first.id, toStage: "perdido", toIndex: 0, lostReason: "  " });
    expect(needsLostReason(lost, { cardId: first.id, toStage: "perdido", toIndex: 0 })).toBe(false);
    expect(lost.flatMap((c) => c.cards).find((c) => c.id === first.id)!.lostReason).toBeNull();
  });
});
