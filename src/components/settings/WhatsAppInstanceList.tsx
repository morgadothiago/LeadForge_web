"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, CircleDashed, Loader2, Pencil, QrCode, RefreshCw, Trash2, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { getFormError } from "@/components/campaigns/form-utils";
import { formatDateTime } from "@/components/leads/lead-format";
import { deleteWhatsAppInstance, disconnectInstance, refreshInstanceStatus } from "@/lib/actions/whatsapp";
import type { ActionResult } from "@/lib/actions/result";
import type { WhatsAppInstanceView } from "@/lib/queries/whatsapp";
import type { InstanceHealthView } from "@/lib/queries/whatsapp-health";
import { cn } from "@/lib/utils";
import { WhatsAppInstanceFormDialog } from "./WhatsAppInstanceFormDialog";
import { WhatsAppHealthPanel } from "./WhatsAppHealthPanel";
import { WhatsAppQrDialog } from "./WhatsAppQrDialog";
import { WhatsAppWebhookSection } from "./WhatsAppWebhookSection";
import { WA_STATUS_INFO, formatInstanceNumber } from "./whatsapp-format";

const PROVIDER_LABELS: Record<string, string> = { evolution: "Evolution API", cloud_api: "WhatsApp Cloud API" };

export function WhatsAppInstanceList({ instances, healths = {} }: { instances: WhatsAppInstanceView[]; healths?: Record<string, InstanceHealthView | null> }) {
  const [announce, setAnnounce] = React.useState("");
  return (
    <>
      <p aria-live="polite" role="status" className="sr-only">
        {announce}
      </p>
      <ul className="grid gap-3">
        {instances.map((i) => (
          <li key={i.id}>
            <InstanceCard instance={i} health={healths[i.id] ?? null} onAnnounce={setAnnounce} />
          </li>
        ))}
      </ul>
    </>
  );
}

function InstanceCard({ instance: i, health, onAnnounce }: { instance: WhatsAppInstanceView; health: InstanceHealthView | null; onAnnounce: (m: string) => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [refreshing, setRefreshing] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [qrOpen, setQrOpen] = React.useState(false);
  const [confirmDel, setConfirmDel] = React.useState(false);
  const [confirmOff, setConfirmOff] = React.useState(false);
  const [dialogError, setDialogError] = React.useState<string>();
  const info = WA_STATUS_INFO[i.status];
  const Icon = info.tone === "ok" ? CheckCircle2 : info.tone === "wait" ? Loader2 : CircleDashed;

  async function refresh() {
    setRefreshing(true);
    try {
      const r = await refreshInstanceStatus(i.id);
      const msg = r.ok ? `${i.instanceName}: ${WA_STATUS_INFO[r.data.status].label}.` : getFormError(r.errors);
      (r.ok ? toast.success : toast.error)(msg);
      onAnnounce(msg);
      router.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  function run(fn: () => Promise<ActionResult<unknown>>, ok: string, done: () => void) {
    setDialogError(undefined);
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        onAnnounce(ok);
        done();
        router.refresh();
      } else setDialogError(getFormError(r.errors));
    });
  }

  const busy = pending || refreshing;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{i.instanceName}</p>
          <p className="text-sm text-muted-foreground">{formatInstanceNumber(i.number)}</p>
        </div>
        <Badge variant={info.tone === "ok" ? "default" : info.tone === "wait" ? "muted" : "destructive"} title={info.description}>
          <Icon className={cn("size-3.5", info.tone === "wait" && "animate-spin")} aria-hidden="true" />
          {info.label}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Provedor</dt>
          <dd>{PROVIDER_LABELS[i.provider] ?? i.provider}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Teto diário</dt>
          <dd>até {i.dailyLimit} mensagens</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Campanhas vinculadas</dt>
          <dd>{i.campaignCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Chave de API</dt>
          <dd>{i.hasApiKey ? "Configurada" : "Ausente"}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-muted-foreground">Última conexão</dt>
          <dd>{i.lastConnectedAt ? <time dateTime={i.lastConnectedAt.toISOString()}>{formatDateTime(i.lastConnectedAt)}</time> : "Nunca conectou"}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">{info.description}</p>
      {health ? <WhatsAppHealthPanel instanceName={i.instanceName} health={health} /> : <p className="text-xs text-muted-foreground">Saúde do envio indisponível no momento. Recarregue a página.</p>}
      {i.lastError && (
        <p className="flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="break-words">Último erro: {i.lastError}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={refresh} disabled={busy} aria-busy={refreshing}>
          <RefreshCw className={cn(refreshing && "animate-spin")} /> {refreshing ? "Atualizando…" : "Atualizar status"}
        </Button>
        {i.status !== "connected" && (
          <Button variant="outline" size="sm" onClick={() => setQrOpen(true)} disabled={busy}>
            <QrCode /> Conectar
          </Button>
        )}
        {i.status !== "disconnected" && (
          <Button variant="outline" size="sm" onClick={() => { setDialogError(undefined); setConfirmOff(true); }} disabled={busy}>
            <Unplug /> Desconectar
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={busy}>
          <Pencil /> Editar
        </Button>
        <Button variant="outline" size="sm" className="text-destructive" onClick={() => { setDialogError(undefined); setConfirmDel(true); }} disabled={busy}>
          <Trash2 /> Excluir
        </Button>
      </div>
      <WhatsAppWebhookSection instanceId={i.id} tokenHint={i.webhookTokenHint} onAnnounce={onAnnounce} />
      {editing && (
        <WhatsAppInstanceFormDialog mode="edit" instance={{ id: i.id, instanceName: i.instanceName, number: i.number, dailyLimit: i.dailyLimit }} open={editing} onOpenChange={setEditing} />
      )}
      {qrOpen && <WhatsAppQrDialog instanceId={i.id} instanceName={i.instanceName} open={qrOpen} onOpenChange={setQrOpen} />}
      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title="Desconectar WhatsApp?"
        description={`"${i.instanceName}" será desconectada do número e deixará de enviar mensagens até ser conectada novamente com um QR code.`}
        confirmLabel="Desconectar"
        destructive
        pending={pending}
        error={dialogError}
        onConfirm={() => run(() => disconnectInstance(i.id), "Instância desconectada.", () => setConfirmOff(false))}
      />
      <ConfirmDialog
        open={confirmDel}
        onOpenChange={setConfirmDel}
        title="Excluir instância?"
        description={`"${i.instanceName}" será removida permanentemente, inclusive no provedor. Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        destructive
        pending={pending}
        error={dialogError}
        onConfirm={() => run(() => deleteWhatsAppInstance(i.id), "Instância excluída.", () => setConfirmDel(false))}
      />
    </Card>
  );
}
