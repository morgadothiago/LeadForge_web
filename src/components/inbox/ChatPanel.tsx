"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { notifyActionError } from "@/components/feedback/notify";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { markConversationRead, sendManualMessage, setConversationStatus } from "@/lib/actions/inbox";
import {
  STATUS_LABEL, effectiveBlockReason, type ConversationStatus, type ConversationView, type MessageView, type ReplyBlockReason,
} from "@/lib/inbox/client-types";
import { Avatar } from "./ConversationList";
import type { LockReason } from "@/components/billing/FeatureLockNotice";
import { Composer, interpretSend, newClientMessageId } from "./Composer";
import { MessageList, MessageListSkeleton } from "./MessageList";
import { loadErrorText, useConversationDetail, useMessages } from "./use-inbox-data";

/** Falha de timeout incerto (backend: TIMEOUT_WARNING): a mensagem PODE ter saido; reenviar sem conferir duplica no WhatsApp do lead. */
export const isUncertainFailure = (m: Pick<MessageView, "error">): boolean => /confirmar o envio/i.test(m.error ?? "");

const STATUSES: readonly ConversationStatus[] = ["waiting", "attending", "closed"];

export interface ChatPanelProps {
  conversationId: string;
  onBack: () => void;
  /** Espelha mudancas locais (lido, status) na lista. */
  onListPatch: (id: string, fn: (c: ConversationView) => ConversationView) => void;
  onUnreadChanged: () => void;
  onListRefresh: () => void;
  /** Mobile: leva o foco ao titulo do chat ao abrir pela escolha do usuario. */
  focusTitleOnMount?: boolean;
  /** SPEC-069d: responder bloqueado pelo plano (o Composer mostra a explicacao + upgrade). */
  replyLock?: LockReason | null;
}

/** Chat da conversa aberta. Montar com `key={conversationId}` (os hooks de dados nao tem efeito de reset). */
export function ChatPanel({ conversationId: id, onBack, onListPatch, onUnreadChanged, onListRefresh, focusTitleOnMount, replyLock = null }: ChatPanelProps) {
  const detail = useConversationDetail(id);
  const [newBelow, setNewBelow] = React.useState(0);
  const [announce, setAnnounce] = React.useState("");
  const [resendingId, setResendingId] = React.useState<string | null>(null);
  const [statusPending, setStatusPending] = React.useState(false);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const readInflight = React.useRef(false);
  const conv = detail.detail;
  const detailPatch = detail.patch;
  const [confirmResend, setConfirmResend] = React.useState<MessageView | null>(null);
  // Bolhas falhas ja substituidas por um reenvio (some a antiga: nada de duas bolhas nem "Reenviar" ativo nela).
  const [superseded, setSuperseded] = React.useState<ReadonlySet<string>>(() => new Set());
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const [forceBottom, setForceBottom] = React.useState(0);
  const nameRef = React.useRef("");
  React.useEffect(() => { nameRef.current = conv?.lead.name ?? ""; });

  React.useEffect(() => {
    if (focusTitleOnMount) titleRef.current?.focus();
  }, [focusTitleOnMount, conv !== null]); // eslint-disable-line react-hooks/exhaustive-deps -- refoca 1x quando o titulo real substitui o "Carregando"

  // Relogio da tela: a janela de 24h pode fechar com a conversa aberta.
  React.useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const markReadNow = React.useCallback(async () => {
    if (readInflight.current || document.visibilityState !== "visible") return;
    readInflight.current = true;
    try {
      const r = await markConversationRead({ conversationId: id });
      if (r.ok) {
        detailPatch((c) => ({ ...c, unreadCount: 0 }));
        onListPatch(id, (c) => ({ ...c, unreadCount: 0 }));
        onUnreadChanged();
      }
    } finally {
      readInflight.current = false;
    }
  }, [id, onListPatch, onUnreadChanged, detailPatch]);

  const messages = useMessages(id, ({ count, inbound }) => {
    setNewBelow((n) => n + count);
    if (inbound) {
      setAnnounce(`Nova mensagem de ${nameRef.current || "contato"}.`);
      void markReadNow();
      onListRefresh();
    }
  });

  // Marcar como lido ao abrir (e ao voltar o foco para a aba com nao lidas).
  const unread = conv?.unreadCount ?? 0;
  React.useEffect(() => {
    if (unread > 0) void markReadNow();
    const onVis = () => { if (document.visibilityState === "visible") void markReadNow(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [unread, markReadNow]);

  const clearNewBelow = React.useCallback(() => setNewBelow(0), []);

  const onSent = (m: MessageView) => {
    messages.addLocal(m);
    setNewBelow(0);
    setForceBottom((n) => n + 1);
    // O servidor SEMPRE promove a "attending" ao enviar (inclusive de "closed"): send-manual.ts atualiza a conversa apos passar das guardas.
    detail.patch((c) => ({ ...c, status: "attending", unreadCount: 0 }));
    onListPatch(id, (c) => ({ ...c, status: "attending", unreadCount: 0, lastMessagePreview: m.body.slice(0, 120), lastMessageDirection: "outbound", lastMessageAt: m.messageAt }));
    onListRefresh();
    detail.refresh();
  };

  const onBlocked = (r: ReplyBlockReason) => {
    detail.patch((c) => ({ ...c, replyBlockedReason: r, lead: r === "opted_out" ? { ...c.lead, optedOut: true } : c.lead }));
  };

  function requestResend(m: MessageView) {
    if (isUncertainFailure(m)) setConfirmResend(m);
    else void resend(m);
  }

  async function resend(m: MessageView) {
    if (resendingId) return;
    setResendingId(m.id);
    try {
      // Reenvio e acao explicita: id novo (o mesmo id devolveria a bolha falha de novo).
      const r = interpretSend(await sendManualMessage({ conversationId: id, clientMessageId: newClientMessageId(), text: m.body }));
      const supersede = () => setSuperseded((prev) => new Set(prev).add(m.id));
      if (r.kind === "sent") { supersede(); onSent(r.message); }
      else if (r.kind === "failed") { supersede(); onSent(r.message); toast.error(r.message.error ?? "Não foi possível enviar a mensagem."); }
      else {
        if (r.blocked) onBlocked(r.blocked);
        if (r.messageId) { supersede(); messages.refresh(); }
        notifyActionError(r.errors);
      }
    } catch {
      toast.error("Sem conexão. Tente reenviar.");
    } finally {
      setResendingId(null);
    }
  }

  async function changeStatus(next: ConversationStatus) {
    if (!conv || next === conv.status || statusPending) return;
    const prev = conv.status;
    setStatusPending(true);
    detail.hold(next);
    detail.patch((c) => ({ ...c, status: next }));
    onListPatch(id, (c) => ({ ...c, status: next }));
    try {
      const r = await setConversationStatus({ conversationId: id, status: next });
      if (!r.ok) throw new Error("status");
      toast.success(next === "closed" ? "Conversa encerrada." : `Status alterado para ${STATUS_LABEL[next]}.`);
      onUnreadChanged();
    } catch {
      detail.hold(null);
      detail.patch((c) => ({ ...c, status: prev }));
      onListPatch(id, (c) => ({ ...c, status: prev }));
      toast.error("Não foi possível alterar o status. Tente de novo.");
    } finally {
      detail.hold(null);
      setStatusPending(false);
    }
  }

  const header = (
    <header className="flex items-center gap-2 border-b border-border p-2 sm:p-3">
      <Button variant="ghost" size="icon" className="size-11 lg:hidden" onClick={onBack} aria-label="Voltar para as conversas">
        <ArrowLeft aria-hidden="true" />
      </Button>
      {conv ? (
        <>
          <Avatar name={conv.lead.name} />
          <div className="min-w-0 flex-1">
            <h2 ref={titleRef} tabIndex={-1} className="truncate text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{conv.lead.name}</h2>
            <p className="truncate text-xs text-muted-foreground">
              {[conv.lead.company, conv.phoneMasked].filter(Boolean).join(" · ")}
              <span className="sr-only"> · WhatsApp {conv.instance.connected && !conv.instance.paused ? "conectado" : "indisponível"}</span>
            </p>
          </div>
          <Link
            href={`/leads/${conv.lead.id}`}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label={`Abrir o lead ${conv.lead.name}`}
            title="Abrir o lead"
          >
            <ExternalLink aria-hidden="true" className="size-4" />
          </Link>
          <div className="shrink-0">
            <label htmlFor="inbox-status" className="sr-only">Status da conversa</label>
            <select
              id="inbox-status"
              value={conv.status}
              disabled={statusPending}
              onChange={(e) => void changeStatus(e.target.value as ConversationStatus)}
              className="h-11 rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 disabled:opacity-50"
            >
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
        </>
      ) : (
        <h2 ref={titleRef} tabIndex={-1} className="flex-1 text-sm text-muted-foreground outline-none">Carregando conversa…</h2>
      )}
    </header>
  );

  if (detail.notFound) {
    return (
      <section aria-label="Conversa" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        {header}
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">Conversa não encontrada. Ela pode ter sido removida.</p>
          <Button variant="outline" className="h-11" onClick={onBack}>Voltar para as conversas</Button>
        </div>
      </section>
    );
  }

  const blocked = conv ? effectiveBlockReason(conv, nowMs) : null;
  const failed = messages.state === "error" && messages.items.length === 0;
  return (
    <section aria-label={conv ? `Conversa com ${conv.lead.name}` : "Conversa"} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
      {header}
      {conv && !conv.instance.connected ? (
        <p role="status" className="flex items-center gap-2 border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <WifiOff aria-hidden="true" className="size-3.5 shrink-0" />
          <span>
            O WhatsApp deste número está desconectado. <Link href="/configuracoes/whatsapp" className="font-medium underline underline-offset-2">Abrir Configurações &gt; WhatsApp</Link>
          </span>
        </p>
      ) : null}
      <p aria-live="polite" role="status" className="sr-only">{announce}</p>
      {messages.offline && messages.state !== "loading" && messages.items.length > 0 ? (
        <p role="status" className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          <WifiOff aria-hidden="true" className="size-3.5" /> Sem conexão. As mensagens podem estar desatualizadas; tentando de novo…
        </p>
      ) : null}
      {messages.state === "loading" ? <MessageListSkeleton /> : null}
      {failed ? (
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">{loadErrorText(messages.errorStatus)}</p>
          <Button variant="outline" className="h-11" onClick={messages.retry}>Tentar de novo</Button>
        </div>
      ) : null}
      {messages.state === "ready" || (messages.state === "error" && messages.items.length > 0) ? (
        <MessageList
          items={superseded.size ? messages.items.filter((m) => !superseded.has(m.id)) : messages.items}
          now={new Date(nowMs)}
          hasMore={messages.hasMore}
          loadingOlder={messages.loadingOlder}
          onLoadOlder={messages.loadOlder}
          forceBottom={forceBottom}
          newBelow={newBelow}
          onClearNewBelow={clearNewBelow}
          onResend={requestResend}
          resendingId={resendingId}
        />
      ) : null}
      {conv ? (
        <Composer conversation={conv} blockedReason={blocked} nowMs={nowMs} onSent={onSent} onBlocked={onBlocked} onRefresh={messages.refresh} replyLock={replyLock} />
      ) : null}
      <ConfirmDialog
        open={confirmResend !== null}
        onOpenChange={(o) => { if (!o) setConfirmResend(null); }}
        title="Reenviar mesmo assim?"
        description="Não foi possível confirmar se esta mensagem chegou. Verifique no WhatsApp do lead antes de reenviar, senão ele pode receber a mensagem duas vezes."
        confirmLabel="Reenviar mesmo assim"
        onConfirm={() => { const m = confirmResend; setConfirmResend(null); if (m) void resend(m); }}
      />
    </section>
  );
}
