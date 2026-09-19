"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDashed, KeyRound, Loader2, Pencil, Plug, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { getFormError } from "@/components/campaigns/form-utils";
import { formatDateTime } from "@/components/leads/lead-format";
import { removeIntegration, testIntegration } from "@/lib/actions/integration";
import type { IntegrationItemView, IntegrationSummary } from "@/lib/integrations/view";
import { IntegrationFormDialog } from "./IntegrationFormDialog";
import { isRateLimitMessage, maskHint, originLabel, statusLabel } from "./integration-format";

export function IntegrationCards({ summaries }: { summaries: IntegrationSummary[] }) {
  const [announce, setAnnounce] = React.useState("");
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      <ul className="grid gap-4 lg:grid-cols-2">
        {summaries.map((s) => (
          <li key={s.integration}>
            <IntegrationCard summary={s} onAnnounce={setAnnounce} />
          </li>
        ))}
      </ul>
    </>
  );
}

function IntegrationCard({ summary, onAnnounce }: { summary: IntegrationSummary; onAnnounce: (m: string) => void }) {
  const router = useRouter();
  const item: IntegrationItemView | undefined = summary.items.find((i) => i.name === "default") ?? summary.items[0];
  const [editing, setEditing] = React.useState(false);
  const [confirmDel, setConfirmDel] = React.useState(false);
  const [delError, setDelError] = React.useState<string>();
  const [delPending, startDel] = React.useTransition();
  const [testing, setTesting] = React.useState(false);
  const [testNote, setTestNote] = React.useState<string>();

  const Icon = summary.configured ? CheckCircle2 : CircleDashed;

  async function test() {
    if (!item) return;
    setTesting(true);
    setTestNote(undefined);
    try {
      const r = await testIntegration(item.id);
      let msg: string;
      let kind: "ok" | "err" | "info";
      if (!r.ok) {
        msg = getFormError(r.errors);
        kind = "err";
      } else if (!r.data.available) {
        msg = r.data.message;
        kind = "info";
      } else {
        msg = r.data.ok ? `Conexão OK. ${r.data.message}` : r.data.message;
        if (!r.data.ok && r.data.retryAfterSeconds) msg += ` Tente novamente em ${r.data.retryAfterSeconds}s.`;
        kind = r.data.ok ? "ok" : "err";
      }
      const full = `${summary.label}: ${msg}`;
      if (kind === "ok") toast.success(full);
      else if (kind === "err") toast.error(full);
      else toast(full);
      setTestNote(isRateLimitMessage(msg) ? `${msg}` : msg);
      onAnnounce(full);
      router.refresh();
    } catch {
      const m = "Não foi possível testar agora. Tente novamente.";
      toast.error(m);
      setTestNote(m);
      onAnnounce(m);
    } finally {
      setTesting(false);
    }
  }

  function remove() {
    if (!item) return;
    setDelError(undefined);
    startDel(async () => {
      const r = await removeIntegration({ id: item.id, confirm: true });
      if (r.ok) {
        const m = `${summary.label}: removida do painel.`;
        toast.success(m);
        onAnnounce(m);
        setConfirmDel(false);
        router.refresh();
      } else setDelError(getFormError(r.errors));
    });
  }

  return (
    <Card className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-heading text-base font-semibold">{summary.label}</h3>
        <Badge variant={summary.configured ? "default" : "muted"}>
          <Icon className="size-3.5" aria-hidden="true" />
          {statusLabel(summary.configured)}
        </Badge>
      </div>

      <dl className="grid gap-1.5 text-sm">
        <div>
          <dt className="sr-only">Origem</dt>
          <dd className="text-muted-foreground">{originLabel(summary.origin)}</dd>
        </div>
        {item && (
          <div className="flex items-center gap-1.5">
            <dt className="text-muted-foreground">Chave:</dt>
            <dd className="font-mono">{maskHint(item.hint)}</dd>
          </div>
        )}
        {item?.baseUrl && (
          <div className="flex flex-wrap gap-1.5">
            <dt className="text-muted-foreground">URL base:</dt>
            <dd className="break-all">{item.baseUrl}</dd>
          </div>
        )}
      </dl>

      {item?.allowPrivateHost && (
        <div>
          <Badge className="bg-warning/15 text-warning">Instância própria (rede privada)</Badge>
        </div>
      )}

      {item && (
        <p className="text-xs text-muted-foreground">
          {item.lastTestedAt
            ? item.lastTestOk
              ? `Testada em ${formatDateTime(item.lastTestedAt)}: OK`
              : `Testada em ${formatDateTime(item.lastTestedAt)}: Erro: ${item.lastTestError ?? "falha desconhecida"}`
            : "Nunca testada."}
        </p>
      )}
      {!summary.testAvailable && <p className="text-xs text-muted-foreground">O teste real de conexão ainda não está disponível para esta integração.</p>}
      {testNote && (
        <p role="status" className="rounded-md bg-muted px-3 py-2 text-xs">
          {testNote}
        </p>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button size="sm" onClick={() => setEditing(true)}>
          {item ? <Pencil /> : <KeyRound />}
          {item ? "Editar / trocar chave" : summary.origin === "env" ? "Salvar no painel" : "Configurar"}
        </Button>
        {item && (
          <Button size="sm" variant="outline" onClick={test} disabled={testing} aria-busy={testing}>
            {testing ? <Loader2 className="animate-spin" /> : <Plug />}
            {testing ? "Testando…" : "Testar conexão"}
          </Button>
        )}
        {item && (
          <Button size="sm" variant="outline" onClick={() => { setDelError(undefined); setConfirmDel(true); }}>
            <Trash2 /> Remover
          </Button>
        )}
      </div>

      <IntegrationFormDialog summary={summary} item={item} open={editing} onOpenChange={setEditing} onAnnounce={onAnnounce} />
      <ConfirmDialog
        open={confirmDel}
        onOpenChange={setConfirmDel}
        title={`Remover ${summary.label}?`}
        description={
          summary.origin === "db"
            ? "A chave salva no painel será apagada e não poderá ser recuperada. Se houver valor no .env, ele voltará a ser usado."
            : "A chave salva no painel será apagada."
        }
        confirmLabel="Remover"
        destructive
        pending={delPending}
        error={delError}
        onConfirm={remove}
      />
    </Card>
  );
}
