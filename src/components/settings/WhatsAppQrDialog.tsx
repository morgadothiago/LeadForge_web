"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, QrCode, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getFormError } from "@/components/campaigns/form-utils";
import { getInstanceQr, refreshInstanceStatus } from "@/lib/actions/whatsapp";
import { initialQrPollState, nextPollDelay, qrPollReducer, shouldPoll } from "./qr-poll";
import { safeQrSrc } from "./whatsapp-format";

function subscribeVisibility(cb: () => void): () => void {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}
const useTabVisible = (): boolean =>
  React.useSyncExternalStore(subscribeVisibility, () => !document.hidden, () => true);

export function WhatsAppQrDialog({ instanceId, instanceName, open, onOpenChange }: { instanceId: string; instanceName: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conectar {instanceName}</DialogTitle>
          <DialogDescription>No celular: WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho e leia o QR code.</DialogDescription>
        </DialogHeader>
        {open && <QrPanel instanceId={instanceId} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function QrPanel({ instanceId, onClose }: { instanceId: string; onClose: () => void }) {
  const router = useRouter();
  const [round, setRound] = React.useState(0);
  return <QrRound key={round} instanceId={instanceId} onRegenerate={() => setRound((r) => r + 1)} onConnected={() => { router.refresh(); }} onClose={onClose} />;
}

function QrRound({ instanceId, onRegenerate, onConnected, onClose }: { instanceId: string; onRegenerate: () => void; onConnected: () => void; onClose: () => void }) {
  const [state, dispatch] = React.useReducer(qrPollReducer, initialQrPollState);
  const [qr, setQr] = React.useState<{ src: string | null; pairingCode: string | null }>({ src: null, pairingCode: null });
  const visible = useTabVisible();

  // Busca o QR uma vez ao montar (cada "Gerar novo QR" remonta com nova key).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await getInstanceQr(instanceId);
      if (cancelled) return;
      if (r.ok) {
        setQr({ src: safeQrSrc(r.data.qrCode), pairingCode: r.data.pairingCode });
        dispatch({ type: "qrLoaded", now: Date.now() });
      } else dispatch({ type: "qrFailed", message: getFormError(r.errors, "Não foi possível obter o QR code.") });
    })();
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  // Polling com backoff; pausa com a aba oculta e para ao desmontar/conectar/expirar.
  React.useEffect(() => {
    if (!shouldPoll(state) || !visible) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await refreshInstanceStatus(instanceId);
      if (cancelled) return;
      if (r.ok) dispatch({ type: "statusChecked", status: r.data.status, now: Date.now() });
      else dispatch({ type: "statusFailed", message: getFormError(r.errors, "Não foi possível consultar o status.") });
    }, nextPollDelay(state.attempts, state.errorStreak));
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [state, visible, instanceId]);

  React.useEffect(() => {
    if (state.phase === "connected") {
      toast.success("WhatsApp conectado.");
      onConnected();
    }
  }, [state.phase, onConnected]);

  const status =
    state.phase === "loading" ? "Gerando QR code…"
    : state.phase === "waiting" ? (visible ? "Aguardando a leitura do QR code…" : "Verificação pausada (aba em segundo plano).")
    : state.phase === "connected" ? "Conectado com sucesso."
    : state.phase === "expired" ? "O QR code expirou."
    : state.phase === "exhausted" ? "Tempo esgotado sem conexão."
    : (state.message ?? "Não foi possível conectar.");

  return (
    <div className="grid gap-4">
      <div className="mx-auto flex size-56 items-center justify-center rounded-lg border border-border bg-white p-2">
        {state.phase === "connected" ? (
          <CheckCircle2 className="size-16 text-primary" aria-hidden="true" />
        ) : state.phase === "loading" ? (
          <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : qr.src && state.phase === "waiting" ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL validada (safeQrSrc), sem otimização possível
          <img src={qr.src} alt="QR code para conectar o WhatsApp" width={208} height={208} className="size-full object-contain" />
        ) : (
          <QrCode className="size-12 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      {qr.pairingCode && state.phase === "waiting" && (
        <p className="text-center text-sm">
          Ou use o código de pareamento: <span className="font-mono font-semibold tracking-wider">{qr.pairingCode}</span>
        </p>
      )}
      {state.phase === "waiting" && !qr.src && <p className="text-center text-xs text-muted-foreground">QR ainda indisponível; continuamos verificando a conexão.</p>}
      <p role="status" aria-live="polite" className={state.phase === "failed" || state.phase === "expired" || state.phase === "exhausted" ? "text-center text-sm text-destructive" : "text-center text-sm text-muted-foreground"}>
        {status}
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose}>{state.phase === "connected" ? "Concluir" : "Fechar"}</Button>
        {(state.phase === "expired" || state.phase === "failed" || state.phase === "exhausted") && (
          <Button onClick={onRegenerate}>
            <RefreshCw /> Gerar novo QR
          </Button>
        )}
      </div>
    </div>
  );
}
