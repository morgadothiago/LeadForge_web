/**
 * SPEC-068b: tipos e regras PURAS da caixa de atendimento para o lado cliente. NUNCA importar aqui nada de servidor (prisma/pg):
 * so `import type` (apagado no build) e constantes puras. Os DTOs vêm das rotas `/api/inbox/**` (068a).
 */
import type { ConversationView, ReplyBlockReason } from "./conversations";
import type { MessageView } from "./messages";

export type { ConversationView, MessageView, ReplyBlockReason };
export type ConversationStatus = ConversationView["status"];
export type DeliveryStatus = MessageView["status"];

export const MESSAGE_MAX = 4096;
export const COUNTER_FROM = 3800;
export const LIST_POLL_MS = 10_000;
export const CHAT_POLL_MS = 4_000;
export const UNREAD_POLL_MS = 20_000;
export const BACKOFF_MAX_MS = 60_000;

export type StatusTab = "all" | ConversationStatus;
export const TABS: readonly { key: StatusTab; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "waiting", label: "Aguardando" },
  { key: "attending", label: "Atendendo" },
  { key: "closed", label: "Encerradas" },
];
export const STATUS_LABEL: Record<ConversationStatus, string> = { waiting: "Aguardando", attending: "Atendendo", closed: "Encerrada" };

/** Motivo (PT-BR) do composer desabilitado. */
export function blockedReasonText(reason: ReplyBlockReason, windowClosesAt: string | null): string {
  switch (reason) {
    case "instance_unavailable":
      return "O WhatsApp deste número está desconectado ou pausado. Reconecte o número em Configurações > WhatsApp para voltar a responder.";
    case "opted_out":
      return "Este contato pediu para não receber mensagens. Não é possível responder.";
    case "conversation_window_closed":
      return windowClosesAt
        ? "A janela de 24 horas para responder terminou. Só dá para responder até 24 horas depois da última mensagem do contato."
        : "Este contato ainda não escreveu para você. Só é possível responder depois que ele enviar uma mensagem.";
  }
}

/**
 * Motivo efetivo com o relógio do cliente: a janela pode fechar enquanto a tela está aberta (o DTO foi calculado no servidor).
 * Mantém o motivo do servidor quando existe; só ACRESCENTA `conversation_window_closed`.
 */
export function effectiveBlockReason(c: Pick<ConversationView, "replyBlockedReason" | "windowClosesAt">, nowMs: number): ReplyBlockReason | null {
  if (c.replyBlockedReason) return c.replyBlockedReason;
  if (c.windowClosesAt && Date.parse(c.windowClosesAt) <= nowMs) return "conversation_window_closed";
  return null;
}

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  sending: "Enviando", sent: "Enviada", delivered: "Entregue", read: "Lida", failed: "Falhou ao enviar",
};

export const ORIGIN_LABEL: Record<MessageView["origin"], string> = {
  lead: "", automation: "Automação", manual: "", device: "Celular",
};

/** Mensagem sem texto (anexos só na 068c/d): rótulo neutro. */
export function bodyOrKindLabel(m: Pick<MessageView, "body" | "kind">): string {
  if (m.body) return m.body;
  const names: Record<MessageView["kind"], string> = {
    text: "(mensagem vazia)", image: "Imagem", audio: "Áudio", document: "Documento", video: "Vídeo", other: "Anexo",
  };
  return m.kind === "text" ? names.text : `${names[m.kind]} (anexos ainda não são exibidos nesta versão)`;
}

/** Ordem total (messageAt, id), igual à do servidor. */
export function compareMessages(a: MessageView, b: MessageView): number {
  return a.messageAt < b.messageAt ? -1 : a.messageAt > b.messageAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Junta mensagens (novas/atualizadas substituem pelo `id`), ordenadas e sem duplicata. */
export function mergeMessages(prev: readonly MessageView[], incoming: readonly MessageView[]): MessageView[] {
  const map = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()].sort(compareMessages);
}

/** Aplica `meta.statuses` (estado atual das enviadas recentes) sem regredir `delivered`/`read`. */
const RANK: Record<DeliveryStatus, number> = { failed: 0, sending: 1, sent: 2, delivered: 3, read: 4 };
export function applyStatuses(items: readonly MessageView[], statuses: readonly { id: string; status: DeliveryStatus; error: string | null }[] | undefined): MessageView[] {
  if (!statuses?.length) return items as MessageView[];
  const byId = new Map(statuses.map((s) => [s.id, s]));
  let changed = false;
  const out = items.map((m) => {
    const s = byId.get(m.id);
    if (!s || (s.status === m.status && s.error === m.error)) return m;
    // `failed` e final vindo do servidor; fora isso nunca regride.
    if (s.status !== "failed" && RANK[s.status] < RANK[m.status]) return m;
    changed = true;
    return { ...m, status: s.status, error: s.error };
  });
  return changed ? out : (items as MessageView[]);
}

/**
 * Atualiza a 1a pagina da lista sem perder as paginas extras ja carregadas: o que veio no topo substitui, e o resto (mais antigo que a
 * ultima conversa do topo) e mantido. Sem proxima pagina no topo = a lista inteira cabe nele.
 */
export function mergeConversationHead(prev: readonly ConversationView[], head: readonly ConversationView[], headHasMore: boolean): ConversationView[] {
  if (!headHasMore || head.length === 0) return [...head];
  const ids = new Set(head.map((c) => c.id));
  const tailFrom = head[head.length - 1].lastMessageAt;
  return [...head, ...prev.filter((c) => !ids.has(c.id) && c.lastMessageAt < tailFrom)];
}

export function appendConversations(prev: readonly ConversationView[], more: readonly ConversationView[]): ConversationView[] {
  const ids = new Set(prev.map((c) => c.id));
  return [...prev, ...more.filter((c) => !ids.has(c.id))];
}

/** Há mensagem recebida (lead) entre as novas? Usado para anunciar e marcar como lida. */
export const hasInbound = (items: readonly MessageView[]): boolean => items.some((m) => m.direction === "inbound");

/** Contador no titulo da aba: `(3) Titulo`; 0 = sem prefixo. */
const PREFIX_RE = /^\(\d+\+?\)\s+/;
export const stripUnreadPrefix = (t: string): string => t.replace(PREFIX_RE, "");
export function withUnreadPrefix(title: string, n: number): string {
  const base = stripUnreadPrefix(title);
  return n > 0 ? `(${n > 99 ? "99+" : n}) ${base}` : base;
}
export const badgeText = (n: number): string => (n > 99 ? "99+" : String(n));
