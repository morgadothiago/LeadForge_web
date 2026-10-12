import { describe, expect, it } from "vitest";
import {
  applyStatuses, appendConversations, badgeText, blockedReasonText, bodyOrKindLabel, effectiveBlockReason, mergeConversationHead, mergeMessages,
  stripUnreadPrefix, withUnreadPrefix, type ConversationView, type MessageView,
} from "./client-types";

const msg = (id: string, at: string, over: Partial<MessageView> = {}): MessageView => ({
  id, direction: "outbound", origin: "manual", kind: "text", body: id, status: "sent", error: null, messageAt: at, clientMessageId: null, sentByName: null, ...over,
});
const conv = (id: string, at: string): ConversationView => ({
  id, status: "waiting", unreadCount: 0, lastMessageAt: at, lastInboundAt: at, lastMessagePreview: id, lastMessageDirection: "inbound", windowClosesAt: null,
  replyBlockedReason: null, phoneMasked: "+55 11 9****-7777", lead: { id: `l-${id}`, name: id, company: null, tags: [], possibleOptOut: false, optedOut: false },
  instance: { id: "i", connected: true, paused: false },
});

describe("effectiveBlockReason", () => {
  it("mantem o motivo do servidor", () => {
    expect(effectiveBlockReason({ replyBlockedReason: "opted_out", windowClosesAt: null }, 0)).toBe("opted_out");
  });
  it("janela que fecha com a tela aberta vira conversation_window_closed (24h00 exato = fechada)", () => {
    const end = "2026-10-12T12:00:00.000Z";
    expect(effectiveBlockReason({ replyBlockedReason: null, windowClosesAt: end }, Date.parse(end) - 1)).toBeNull();
    expect(effectiveBlockReason({ replyBlockedReason: null, windowClosesAt: end }, Date.parse(end))).toBe("conversation_window_closed");
  });
});

describe("blockedReasonText", () => {
  it("cada motivo tem texto PT-BR proprio", () => {
    expect(blockedReasonText("opted_out", null)).toMatch(/não receber/);
    expect(blockedReasonText("instance_unavailable", null)).toMatch(/desconectado ou pausado/);
    expect(blockedReasonText("conversation_window_closed", "2026-10-12T12:00:00Z")).toMatch(/24 horas/);
    expect(blockedReasonText("conversation_window_closed", null)).toMatch(/ainda não escreveu/);
  });
});

describe("mergeMessages / applyStatuses", () => {
  it("dedup por id, ordena por (messageAt, id) e a versao nova substitui", () => {
    const out = mergeMessages([msg("b", "2026-01-01T10:00:00Z"), msg("a", "2026-01-01T10:00:00Z")], [msg("b", "2026-01-01T10:00:00Z", { status: "delivered" }), msg("c", "2026-01-01T09:00:00Z")]);
    expect(out.map((m) => m.id)).toEqual(["c", "a", "b"]);
    expect(out.find((m) => m.id === "b")?.status).toBe("delivered");
  });
  it("status nunca regride (read > delivered > sent), mas failed e aplicado", () => {
    const items = [msg("a", "2026-01-01T10:00:00Z", { status: "read" }), msg("b", "2026-01-01T10:01:00Z", { status: "sent" }), msg("c", "2026-01-01T10:02:00Z", { status: "sending" })];
    const out = applyStatuses(items, [{ id: "a", status: "delivered", error: null }, { id: "b", status: "delivered", error: null }, { id: "c", status: "failed", error: "Falhou" }]);
    expect(out.map((m) => m.status)).toEqual(["read", "delivered", "failed"]);
    expect(out[2].error).toBe("Falhou");
  });
  it("sem mudanca devolve a mesma referencia", () => {
    const items = [msg("a", "2026-01-01T10:00:00Z")];
    expect(applyStatuses(items, [{ id: "a", status: "sent", error: null }])).toBe(items);
  });
});

describe("lista de conversas", () => {
  it("poll do topo substitui e mantem as paginas extras mais antigas", () => {
    const prev = [conv("a", "2026-01-05T00:00:00Z"), conv("b", "2026-01-04T00:00:00Z"), conv("c", "2026-01-03T00:00:00Z"), conv("d", "2026-01-02T00:00:00Z")]
    // topo (2 itens, ha mais): c subiu; "b" (mais antigo que o fim do topo) e "d" ficam das paginas extras; "c" nao duplica;
    const head = [conv("c", "2026-01-06T00:00:00Z"), conv("a", "2026-01-05T00:00:00Z")];
    expect(mergeConversationHead(prev, head, true).map((c) => c.id)).toEqual(["c", "a", "b", "d"]);
    expect(mergeConversationHead(prev, head, false).map((c) => c.id)).toEqual(["c", "a"]);
  });
  it("append sem duplicar", () => {
    expect(appendConversations([conv("a", "2026-01-05T00:00:00Z")], [conv("a", "2026-01-05T00:00:00Z"), conv("b", "2026-01-04T00:00:00Z")]).map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("titulo e badge", () => {
  it("prefixo (n) e idempotente, 0 remove, 99+", () => {
    expect(withUnreadPrefix("LeadForge", 3)).toBe("(3) LeadForge");
    expect(withUnreadPrefix("(3) LeadForge", 5)).toBe("(5) LeadForge");
    expect(withUnreadPrefix("(3) LeadForge", 0)).toBe("LeadForge");
    expect(withUnreadPrefix("LeadForge", 120)).toBe("(99+) LeadForge");
    expect(stripUnreadPrefix("(99+) X")).toBe("X");
    expect(badgeText(100)).toBe("99+");
  });
  it("mensagem sem texto mostra rotulo neutro", () => {
    expect(bodyOrKindLabel({ body: "oi", kind: "text" })).toBe("oi");
    expect(bodyOrKindLabel({ body: "", kind: "image" })).toMatch(/^Imagem/);
  });
});
