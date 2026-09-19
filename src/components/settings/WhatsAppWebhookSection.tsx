"use client";
import * as React from "react";
import { AlertTriangle, Copy, Eye, EyeOff, KeyRound, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { getFormError } from "@/components/campaigns/form-utils";
import { getInstanceWebhookConfig, rotateWebhookToken } from "@/lib/actions/whatsapp";
import { maskWebhookUrl } from "./whatsapp-format";

interface Loaded {
  url: string;
  token: string;
}

export function WhatsAppWebhookSection({ instanceId, tokenHint, onAnnounce }: { instanceId: string; tokenHint: string; onAnnounce: (m: string) => void }) {
  const [full, setFull] = React.useState<Loaded | null>(null);
  const [rotated, setRotated] = React.useState<{ webhookUrl: string; tokenHint: string } | null>(null);
  const [reveal, setReveal] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [loading, startLoad] = React.useTransition();
  const [confirm, setConfirm] = React.useState(false);
  const [rotError, setRotError] = React.useState<string>();
  const [rotating, startRotate] = React.useTransition();
  const [copied, setCopied] = React.useState(false);
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(copyTimer.current), []);

  function load() {
    setError(undefined);
    startLoad(async () => {
      const r = await getInstanceWebhookConfig(instanceId);
      if (r.ok) {
        setFull({ url: r.data.url, token: r.data.token });
        setRotated(null);
        setReveal(false);
      } else setError(getFormError(r.errors));
    });
  }

  async function copy() {
    if (!full) return;
    try {
      await navigator.clipboard.writeText(full.url);
      setCopied(true);
      onAnnounce("URL do webhook copiada.");
      toast.success("URL do webhook copiada.");
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Não foi possível copiar. Revele a URL e copie manualmente.");
      onAnnounce("Não foi possível copiar a URL.");
    }
  }

  function rotate() {
    startRotate(async () => {
      const r = await rotateWebhookToken(instanceId);
      if (r.ok) {
        setRotated(r.data);
        setFull(null);
        setReveal(false);
        setConfirm(false);
        toast.success("Novo token gerado e webhook reconfigurado.");
        onAnnounce("Novo token do webhook gerado.");
      } else setRotError(getFormError(r.errors));
    });
  }

  const shown = rotated ? rotated.webhookUrl : full ? (reveal ? full.url : maskWebhookUrl(full.url, full.token)) : null;

  return (
    <section aria-label="Webhook" className="space-y-2 rounded-md border border-border p-3">
      <h4 className="flex items-center gap-1.5 text-sm font-medium">
        <Webhook className="size-4" aria-hidden="true" /> Webhook (respostas recebidas)
      </h4>
      <p className="flex gap-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
        <span>
          A URL contém um token secreto e aparece em logs do servidor. Não compartilhe. O Evolution precisa alcançar o <code>APP_BASE_URL</code> do sistema para entregar as respostas. Token atual: {rotated?.tokenHint ?? tokenHint}.
        </span>
      </p>
      {shown && (
        <p className="break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs" aria-label="URL do webhook">
          {shown}
        </p>
      )}
      {rotated && <p className="text-xs text-muted-foreground">O token antigo deixou de valer. Para ver ou copiar a URL completa, use &ldquo;Mostrar URL do webhook&rdquo;.</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!full ? (
          <Button variant="outline" size="sm" onClick={load} disabled={loading} aria-busy={loading}>
            <Eye /> {loading ? "Carregando…" : "Mostrar URL do webhook"}
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => setReveal((v) => !v)} aria-pressed={reveal}>
              {reveal ? <EyeOff /> : <Eye />} {reveal ? "Ocultar token" : "Revelar token"}
            </Button>
            <Button variant="outline" size="sm" onClick={copy}>
              <Copy /> {copied ? "Copiada!" : "Copiar URL"}
            </Button>
          </>
        )}
        <Button variant="outline" size="sm" onClick={() => { setRotError(undefined); setConfirm(true); }}>
          <KeyRound /> Gerar novo token
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Gerar novo token do webhook?"
        description="O webhook será reconfigurado no provedor com uma nova URL e o token antigo deixará de valer imediatamente. Se a reconfiguração falhar, o token atual continua válido."
        confirmLabel="Gerar novo token"
        destructive
        pending={rotating}
        error={rotError}
        onConfirm={rotate}
      />
    </section>
  );
}
