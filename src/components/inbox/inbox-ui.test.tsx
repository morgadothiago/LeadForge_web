// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/atendimento", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/actions/inbox", () => ({ sendManualMessage: vi.fn(), markConversationRead: vi.fn(), setConversationStatus: vi.fn() }));

import type { ConversationView, MessageView } from "@/lib/inbox/client-types";
import { isUncertainFailure } from "./ChatPanel";
import { Composer, interpretSend } from "./Composer";
import { ConversationList, type ConversationListProps } from "./ConversationList";
import { MessageBubble } from "./MessageBubble";
import { MessageList } from "./MessageList";

const NOW = new Date(2026, 9, 12, 15, 0, 0);
const conv = (over: Partial<ConversationView> = {}): ConversationView => ({
  id: "11111111-1111-4111-8111-111111111111", status: "waiting", unreadCount: 0, lastMessageAt: new Date(2026, 9, 12, 14, 0).toISOString(),
  lastInboundAt: new Date(2026, 9, 12, 14, 0).toISOString(), lastMessagePreview: "Oi, tudo bem?", lastMessageDirection: "inbound",
  windowClosesAt: new Date(2026, 9, 13, 14, 0).toISOString(), replyBlockedReason: null, phoneMasked: "+55 11 9****-7777",
  lead: { id: "l1", name: "Ana Souza", company: "Acme", tags: [], possibleOptOut: false, optedOut: false },
  instance: { id: "i1", connected: true, paused: false }, ...over,
});
const msg = (over: Partial<MessageView> = {}): MessageView => ({
  id: "m1", direction: "inbound", origin: "lead", kind: "text", body: "Olá", status: "delivered", error: null,
  messageAt: new Date(2026, 9, 12, 14, 0).toISOString(), clientMessageId: null, sentByName: null, ...over,
});
const listProps = (over: Partial<ConversationListProps> = {}): ConversationListProps => ({
  items: [], state: "ready", errorText: "Falha ao carregar", offline: false, tab: "all", onTab: vi.fn(), query: "", onQuery: vi.fn(), selectedId: null,
  onSelect: vi.fn(), hasMore: false, loadingMore: false, onLoadMore: vi.fn(), onRetry: vi.fn(), now: NOW, ...over,
});

describe("ConversationList", () => {
  it("abas Todas/Aguardando/Atendendo/Encerradas com role tab e a ativa marcada", () => {
    const html = renderToStaticMarkup(<ConversationList {...listProps({ tab: "attending" })} />);
    for (const l of ["Todas", "Aguardando", "Atendendo", "Encerradas"]) expect(html).toContain(`>${l}<`);
    expect(html).toContain('role="tablist"');
    expect((html.match(/role="tab"/g) ?? []).length).toBe(4);
    expect(html).toMatch(/aria-selected="true"[^>]*>Atendendo|id="inbox-tab-attending"[^>]*aria-selected="true"/);
  });
  it("carregando = skeleton com role status; erro = alerta + Tentar de novo; vazio explica", () => {
    expect(renderToStaticMarkup(<ConversationList {...listProps({ state: "loading" })} />)).toContain('aria-label="Carregando conversas"');
    const err = renderToStaticMarkup(<ConversationList {...listProps({ state: "error" })} />);
    expect(err).toContain('role="alert"');
    expect(err).toContain("Falha ao carregar");
    expect(err).toContain("Tentar de novo");
    const empty = renderToStaticMarkup(<ConversationList {...listProps()} />);
    expect(empty).toContain("Nenhuma conversa ainda");
    expect(empty).toContain("Quando um lead responder no WhatsApp");
    expect(renderToStaticMarkup(<ConversationList {...listProps({ tab: "closed" })} />)).toContain("Nenhuma conversa encontrada");
  });
  it("item: nome, ultima mensagem, hora, badge de nao lidas com texto sr-only, aria-current na selecionada", () => {
    const c = conv({ unreadCount: 3 });
    const html = renderToStaticMarkup(<ConversationList {...listProps({ items: [c], selectedId: c.id })} />);
    expect(html).toContain("Ana Souza");
    expect(html).toContain("Oi, tudo bem?");
    expect(html).toContain("14:00");
    expect(html).toContain("3 mensagens não lidas");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('aria-label="Lista de conversas"');
  });
  it("nome/preview com HTML sao escapados (nunca interpretados)", () => {
    const c = conv({ lastMessagePreview: "<img src=x onerror=alert(1)>", lead: { ...conv().lead, name: "<b>Eva</b>" } });
    const html = renderToStaticMarkup(<ConversationList {...listProps({ items: [c] })} />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>Eva");
    expect(html).toContain("&lt;img");
  });
  it("aviso de offline quando ha dados e a rede falha", () => {
    expect(renderToStaticMarkup(<ConversationList {...listProps({ offline: true })} />)).toContain("Sem conexão");
  });
});

describe("MessageBubble", () => {
  it("HTML malicioso vira texto escapado; link javascript: nao vira <a>", () => {
    const html = renderToStaticMarkup(<MessageBubble m={msg({ body: '<script>alert(1)</script> javascript:alert(2) <a href="javascript:x">x</a>' })} />);
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/<a [^>]*href="javascript/i);
    expect(html).not.toContain("<a ");
    expect(html).toContain("&lt;script&gt;");
  });
  it("https vira link com rel seguro", () => {
    const html = renderToStaticMarkup(<MessageBubble m={msg({ body: "veja https://exemplo.com/x" })} />);
    expect(html).toContain('href="https://exemplo.com/x"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });
  it.each([
    ["sending", "Enviando"], ["sent", "Enviada"], ["delivered", "Entregue"], ["read", "Lida"], ["failed", "Falhou ao enviar"],
  ] as const)("status %s tem rotulo acessivel", (status, label) => {
    const html = renderToStaticMarkup(<MessageBubble m={msg({ direction: "outbound", origin: "manual", status, error: status === "failed" ? "Número inválido." : null })} />);
    expect(html).toContain(label);
  });
  it("entrada nao mostra status de entrega; origem identificada (automacao, celular, usuario)", () => {
    expect(renderToStaticMarkup(<MessageBubble m={msg()} />)).not.toContain("Entregue");
    expect(renderToStaticMarkup(<MessageBubble m={msg({ direction: "outbound", origin: "automation" })} />)).toContain("Automação");
    expect(renderToStaticMarkup(<MessageBubble m={msg({ direction: "outbound", origin: "device" })} />)).toContain("Celular");
    expect(renderToStaticMarkup(<MessageBubble m={msg({ direction: "outbound", origin: "manual", sentByName: "Bruno" })} />)).toContain("Bruno");
  });
  it("falha mostra o erro e o botao Reenviar (alvo >= 44px)", () => {
    const html = renderToStaticMarkup(<MessageBubble m={msg({ direction: "outbound", origin: "manual", status: "failed", error: "Não foi possível confirmar o envio." })} onResend={vi.fn()} />);
    expect(html).toContain("Não foi possível confirmar o envio.");
    expect(html).toContain("Reenviar");
    expect(html).toContain("min-h-11");
    expect(html).toContain('role="alert"');
  });
});

describe("MessageList", () => {
  it("separadores de data Hoje/Ontem e historico acessivel", () => {
    const html = renderToStaticMarkup(
      <MessageList
        items={[msg({ id: "a", messageAt: new Date(2026, 9, 11, 10, 0).toISOString() }), msg({ id: "b", messageAt: new Date(2026, 9, 12, 10, 0).toISOString() })]}
        now={NOW} hasMore={false} loadingOlder={false} onLoadOlder={async () => true} forceBottom={0} newBelow={0} onClearNewBelow={vi.fn()} onResend={vi.fn()} resendingId={null}
      />,
    );
    expect(html).toContain(">Ontem<");
    expect(html).toContain(">Hoje<");
    expect(html).toContain('aria-label="Histórico de mensagens"');
  });
  it("mostra 'N novas mensagens' e o carregar anteriores", () => {
    const html = renderToStaticMarkup(
      <MessageList items={[msg()]} now={NOW} hasMore loadingOlder={false} onLoadOlder={async () => true} forceBottom={0} newBelow={2} onClearNewBelow={vi.fn()} onResend={vi.fn()} resendingId={null} />,
    );
    expect(html).toContain("2 novas mensagens");
    expect(html).toContain("Carregar mensagens anteriores");
  });
});

const composerProps = (c: ConversationView, blocked: Parameters<typeof Composer>[0]["blockedReason"] = null) => ({
  conversation: c, blockedReason: blocked, nowMs: NOW.getTime(), onSent: vi.fn(), onBlocked: vi.fn(), onRefresh: vi.fn(),
});

describe("Composer", () => {
  it("habilitado: textarea rotulado, Enviar, dica de Enter/Shift+Enter", () => {
    const html = renderToStaticMarkup(<Composer {...composerProps(conv())} />);
    expect(html).toContain("Mensagem para Ana Souza");
    expect(html).toContain("Enviar");
    expect(html).toContain("Shift+Enter");
    expect(html).not.toContain("indisponível");
  });
  it.each([
    ["conversation_window_closed", "janela de 24 horas"],
    ["opted_out", "não receber mensagens"],
    ["instance_unavailable", "desconectado ou pausado"],
  ] as const)("bloqueado por %s mostra o motivo e nao oferece envio", (reason, text) => {
    const html = renderToStaticMarkup(<Composer {...composerProps(conv({ replyBlockedReason: reason }), reason)} />);
    expect(html).toContain(text);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('id="inbox-composer"');
    expect(html).not.toContain(">Enviar<");
  });
  it("instancia desconectada oferece link para Configuracoes > WhatsApp", () => {
    const html = renderToStaticMarkup(<Composer {...composerProps(conv(), "instance_unavailable")} />);
    expect(html).toContain('href="/configuracoes/whatsapp"');
  });
  it("possibleOptOut: aviso forte visivel antes de enviar", () => {
    const c = conv({ lead: { ...conv().lead, possibleOptOut: true } });
    expect(renderToStaticMarkup(<Composer {...composerProps(c)} />)).toContain("pode ter pedido para parar");
  });
});

describe("interpretSend (contrato B3)", () => {
  it("ok + bolha enviada = sent", () => {
    expect(interpretSend({ ok: true, data: { message: msg({ status: "sent" }), duplicate: false } }).kind).toBe("sent");
  });
  it("ok:true, duplicate:true com status failed = failed (nao some em silencio)", () => {
    const r = interpretSend({ ok: true, data: { message: msg({ status: "failed", error: "x" }), duplicate: true } });
    expect(r.kind).toBe("failed");
  });
  it("erro tipado: reconhece motivo de bloqueio e messageId", () => {
    const r = interpretSend({ ok: false, errors: { _form: ["Janela fechada."], code: ["conversation_window_closed"], messageId: ["m9"] } });
    expect(r).toMatchObject({ kind: "error", blocked: "conversation_window_closed", messageId: "m9" });
    expect(interpretSend({ ok: false, errors: { _form: ["x"], code: ["rate_limited"] } })).toMatchObject({ kind: "error", blocked: null, messageId: null });
  });
});

describe("reenvio (QA M1)", () => {
  it("timeout incerto exige confirmacao; falha comum nao", () => {
    expect(isUncertainFailure({ error: "Não foi possível confirmar o envio; verifique no WhatsApp antes de reenviar." })).toBe(true);
    expect(isUncertainFailure({ error: "Número sem WhatsApp." })).toBe(false);
    expect(isUncertainFailure({ error: null })).toBe(false);
  });
});
