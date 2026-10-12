"use client";
import * as React from "react";
import Link from "next/link";
import { Info, Send } from "lucide-react";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { notifyActionError } from "@/components/feedback/notify";
import { Button } from "@/components/ui/button";
import { sendManualMessage } from "@/lib/actions/inbox";
import {
  COUNTER_FROM, MESSAGE_MAX, blockedReasonText, type ConversationView, type MessageView, type ReplyBlockReason,
} from "@/lib/inbox/client-types";
import { toast } from "sonner";
import { windowHint } from "./inbox-format";

const BLOCKED_CODES: readonly ReplyBlockReason[] = ["opted_out", "conversation_window_closed", "instance_unavailable"];

export function newClientMessageId(): string {
  return globalThis.crypto.randomUUID();
}

/** Resultado do envio traduzido para a UI. `failed`: o servidor devolveu a bolha, mas a entrega falhou (contrato B3, tambem com `duplicate: true`). */
export function interpretSend(r: { ok: true; data: { message: MessageView; duplicate: boolean } } | { ok: false; errors: Record<string, string[]> }):
  | { kind: "sent"; message: MessageView }
  | { kind: "failed"; message: MessageView }
  | { kind: "error"; errors: Record<string, string[]>; blocked: ReplyBlockReason | null; messageId: string | null } {
  if (r.ok) return r.data.message.status === "failed" ? { kind: "failed", message: r.data.message } : { kind: "sent", message: r.data.message };
  const code = r.errors.code?.[0];
  return { kind: "error", errors: r.errors, blocked: BLOCKED_CODES.find((b) => b === code) ?? null, messageId: r.errors.messageId?.[0] ?? null };
}

export interface ComposerProps {
  conversation: ConversationView;
  /** Motivo efetivo (servidor + relogio do cliente). */
  blockedReason: ReplyBlockReason | null;
  nowMs: number;
  onSent: (m: MessageView) => void;
  /** Erro do servidor que bloqueia a conversa (ex.: opt-out descoberto agora): o pai atualiza o DTO. */
  onBlocked: (r: ReplyBlockReason) => void;
  /** Pede ao pai para buscar mensagens ja (bolha `failed` criada no servidor). */
  onRefresh: () => void;
}

export function Composer({ conversation, blockedReason, nowMs, onSent, onBlocked, onRefresh }: ComposerProps) {
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  // Mesmo texto + mesmo id = reenvio idempotente se a rede falhou sem resposta (o servidor devolve a bolha existente em vez de duplicar).
  const pending = React.useRef<{ id: string; text: string } | null>(null);
  const areaRef = React.useRef<HTMLTextAreaElement>(null);
  const trimmed = text.trim();
  const tooLong = text.length > MESSAGE_MAX;
  const canSend = !blockedReason && !sending && trimmed.length > 0 && !tooLong;

  async function doSend() {
    setSending(true);
    setInlineError(null);
    const body = text.trim();
    if (!pending.current || pending.current.text !== body) pending.current = { id: newClientMessageId(), text: body };
    try {
      const r = interpretSend(await sendManualMessage({ conversationId: conversation.id, clientMessageId: pending.current.id, text: body }));
      if (r.kind === "sent") {
        pending.current = null;
        setText((cur) => (cur.trim() === body ? "" : cur)); // se ja digitou algo novo durante o envio, preserva
        onSent(r.message);
      } else if (r.kind === "failed") {
        // B3: `ok:true` com bolha falha (inclusive reenvio do mesmo clientMessageId). A bolha mostra o erro e o "Reenviar" (id novo).
        pending.current = null;
        setText((cur) => (cur.trim() === body ? "" : cur));
        onSent(r.message);
        // A bolha falha ja tem role=alert; so o toast acompanha (no maximo 2 anuncios).
        toast.error(r.message.error ?? "Não foi possível enviar a mensagem.");
      } else {
        if (r.messageId) { pending.current = null; setText((cur) => (cur.trim() === body ? "" : cur)); onRefresh(); }
        if (r.blocked) onBlocked(r.blocked);
        // Com bolha falha (messageId) o alerta fica na bolha; sem bolha, alerta inline + toast.
        if (!r.messageId) setInlineError(r.errors._form?.[0] ?? "Não foi possível enviar a mensagem.");
        notifyActionError(r.errors);
      }
    } catch {
      setInlineError("Sem conexão. Sua mensagem não foi perdida: tente enviar de novo.");
      toast.error("Sem conexão. Tente enviar de novo.");
    } finally {
      setSending(false);
      areaRef.current?.focus();
    }
  }

  function requestSend() {
    if (!canSend) return;
    if (conversation.lead.possibleOptOut) setConfirmOpen(true);
    else void doSend();
  }

  if (blockedReason) {
    return (
      <div className="border-t border-border bg-muted/50 p-3">
        <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            {blockedReasonText(blockedReason, conversation.windowClosesAt)}{" "}
            {blockedReason === "instance_unavailable" ? (
              <Link href="/configuracoes/whatsapp" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2">Abrir Configurações &gt; WhatsApp</Link>
            ) : null}
          </span>
        </p>
        <label htmlFor="inbox-composer-disabled" className="sr-only">Mensagem (indisponível)</label>
        <textarea id="inbox-composer-disabled" disabled rows={1} placeholder="Resposta indisponível" className="mt-2 hidden w-full resize-none rounded-md border border-input bg-transparent p-2 text-sm opacity-50 sm:block" />
      </div>
    );
  }

  const hint = windowHint(conversation.windowClosesAt, nowMs);
  return (
    <div className="border-t border-border bg-card p-3">
      {conversation.lead.possibleOptOut ? (
        <p role="note" className="mb-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Este contato pode ter pedido para parar de receber mensagens. Confira o histórico antes de responder.
        </p>
      ) : null}
      {hint ? <p className="mb-2 text-xs text-muted-foreground">{hint}</p> : null}
      <form
        onSubmit={(e) => { e.preventDefault(); requestSend(); }}
        className="flex items-end gap-2"
      >
        <div className="min-w-0 flex-1">
          <label htmlFor="inbox-composer" className="sr-only">Mensagem para {conversation.lead.name}</label>
          <textarea
            id="inbox-composer"
            ref={areaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); requestSend(); }
            }}
            rows={2}
            maxLength={MESSAGE_MAX + 500}
            placeholder="Escreva uma mensagem (Enter envia, Shift+Enter quebra a linha)"
            aria-invalid={tooLong || inlineError ? true : undefined}
            aria-describedby="inbox-composer-help"
            className="max-h-40 min-h-11 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-[3px] focus:ring-primary/20 aria-invalid:border-destructive"
          />
          <div id="inbox-composer-help" className="flex min-h-5 items-center justify-between gap-2 pt-1 text-xs">
            <span role={inlineError ? "alert" : undefined} className="text-destructive">{tooLong ? `A mensagem passa de ${MESSAGE_MAX} caracteres.` : inlineError}</span>
            {text.length > COUNTER_FROM ? <span className={tooLong ? "font-medium text-destructive" : "text-muted-foreground"}>{text.length}/{MESSAGE_MAX}</span> : null}
          </div>
        </div>
        <Button type="submit" className="h-11 min-w-11 px-4" disabled={!canSend} aria-busy={sending}>
          <Send aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">{sending ? "Enviando…" : "Enviar"}</span>
        </Button>
      </form>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Enviar mesmo assim?"
        description="Este contato pode ter pedido para parar de receber mensagens. Responder pode gerar denúncia e prejudicar o seu número. Quer enviar assim mesmo?"
        confirmLabel="Enviar mesmo assim"
        destructive
        pending={sending}
        onConfirm={() => { setConfirmOpen(false); void doSend(); }}
      />
    </div>
  );
}
