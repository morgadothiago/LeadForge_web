import { describe, expect, it } from "vitest";
import {
  SEQUENCE_STATUS_TEXT, autoStartLabel, formatReasons, hasNoChannels, isSeedSource, leadSequenceAction, leadSequenceText,
  startBlockedReason, startResultText, startSummaryText,
} from "./sequence-start-format";

const f = { dateTime: () => "01/01 10:00", relative: () => "em 2 dias" };
const base = { nextTouchAt: null, repliedAt: null, optedOutAt: null };

describe("sequence-start-format", () => {
  it("rótulos cobrem paused_manual", () => {
    expect(SEQUENCE_STATUS_TEXT.paused_manual).toBe("Pausada manualmente");
    expect(Object.keys(SEQUENCE_STATUS_TEXT)).toHaveLength(6);
  });
  it("autoStart", () => {
    expect(autoStartLabel(true)).toBe("Automático");
    expect(autoStartLabel(false)).toBe("Manual");
  });
  it("resumo singular/plural", () => {
    expect(startSummaryText(3, 2)).toBe("3 leads serão iniciados; 2 não podem ser iniciados.");
    expect(startSummaryText(1, 1)).toBe("1 lead será iniciado; 1 não pode ser iniciado.");
  });
  it("motivos ordenados, sem ponto final e sem zeros", () => {
    expect(formatReasons([{ label: "A.", count: 1 }, { label: "B.", count: 4 }, { label: "C.", count: 0 }])).toEqual(["B (4)", "A (1)"]);
  });
  it("bloqueios", () => {
    expect(startBlockedReason({ campaignActive: false, hasSequence: true, eligible: 5 })).toMatch(/não está ativa/);
    expect(startBlockedReason({ campaignActive: true, hasSequence: false, eligible: 5 })).toMatch(/não tem sequência/);
    expect(startBlockedReason({ campaignActive: true, hasSequence: true, eligible: 0 })).toMatch(/Nenhum lead/);
    expect(startBlockedReason({ campaignActive: true, hasSequence: true, eligible: 2 })).toBeNull();
  });
  it("resultado", () => {
    expect(startResultText(0, 0)).toBe("Nenhum lead foi iniciado.");
    expect(startResultText(2, 1)).toBe("2 leads iniciados; 1 não pôde ser iniciado.");
  });
  it("texto da ficha", () => {
    expect(leadSequenceText({ ...base, sequenceStatus: "paused_manual" }, f)).toMatch(/Você pausou esta sequência/);
    expect(leadSequenceText({ ...base, sequenceStatus: "active", nextTouchAt: new Date() }, f)).toBe("Sequência ativa. Próximo contato em 2 dias (01/01 10:00).");
    expect(leadSequenceText({ ...base, sequenceStatus: "not_started" }, f)).toMatch(/ainda não iniciada/);
  });
  it("ação do lead, seed e canais", () => {
    expect(leadSequenceAction("not_started")).toBe("start");
    expect(leadSequenceAction("paused_manual")).toBe("start");
    expect(leadSequenceAction("active")).toBe("stop");
    expect(leadSequenceAction("completed")).toBeNull();
    expect(isSeedSource("seed")).toBe(true);
    expect(isSeedSource("manual")).toBe(false);
    expect(hasNoChannels([{ isActive: false }], [{ status: "disconnected" }])).toBe(true);
    expect(hasNoChannels([], [{ status: "connected" }])).toBe(false);
    expect(hasNoChannels([{ isActive: true }], [])).toBe(false);
  });
});
