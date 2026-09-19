"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, CircleDashed, Pencil, Plug, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { getFormError } from "@/components/campaigns/form-utils";
import { deleteEmailAccount, setActive, testEmailConnection } from "@/lib/actions/email";
import type { EmailAccountView } from "@/lib/queries/email";
import { cn } from "@/lib/utils";
import { EmailAccountFormDialog } from "./EmailAccountFormDialog";
import { formatVerification, providerLabel } from "./email-presets";

export function EmailAccountList({ accounts }: { accounts: EmailAccountView[] }) {
  const [announce, setAnnounce] = React.useState("");
  return (
    <>
      <p aria-live="polite" role="status" className="sr-only">
        {announce}
      </p>
      <ul className="grid gap-3">
        {accounts.map((a) => (
          <li key={a.id}>
            <AccountCard account={a} onAnnounce={setAnnounce} />
          </li>
        ))}
      </ul>
    </>
  );
}

function AccountCard({ account: a, onAnnounce }: { account: EmailAccountView; onAnnounce: (m: string) => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [testing, setTesting] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [confirmDel, setConfirmDel] = React.useState(false);
  const [delError, setDelError] = React.useState<string>();
  const v = formatVerification(a.lastVerifiedAt, a.lastError);
  const Icon = v.tone === "ok" ? CheckCircle2 : v.tone === "error" ? CircleAlert : CircleDashed;

  async function test() {
    setTesting(true);
    onAnnounce(`Testando conexão de ${a.email}…`);
    try {
      const r = await testEmailConnection(a.id);
      const msg = r.ok ? r.data.message : getFormError(r.errors);
      const good = r.ok && r.data.ok;
      (good ? toast.success : toast.error)(msg);
      onAnnounce(`${a.email}: ${msg}`);
      router.refresh();
    } finally {
      setTesting(false);
    }
  }

  function toggle() {
    startTransition(async () => {
      const r = await setActive({ id: a.id, isActive: !a.isActive });
      if (r.ok) {
        toast.success(a.isActive ? "Conta desativada." : "Conta ativada.");
        router.refresh();
      } else toast.error(getFormError(r.errors));
    });
  }

  function remove() {
    startTransition(async () => {
      const r = await deleteEmailAccount(a.id);
      if (r.ok) {
        toast.success("Conta excluída.");
        setConfirmDel(false);
        router.refresh();
      } else setDelError(getFormError(r.errors));
    });
  }

  const busy = pending || testing;
  return (
    <Card className={cn("space-y-3 p-4", !a.isActive && "opacity-80")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{a.email}</p>
          <p className="truncate text-sm text-muted-foreground">{a.fromName ? `Remetente: ${a.fromName}` : "Sem nome de remetente"}</p>
        </div>
        <Badge variant={a.isActive ? "default" : "muted"}>{a.isActive ? "Ativa" : "Inativa"}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Provedor</dt>
          <dd>{providerLabel(a.provider)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Servidor SMTP</dt>
          <dd className="truncate">
            {a.smtpHost}:{a.port}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Limite diário</dt>
          <dd>{a.dailyLimit} envios</dd>
        </div>
      </dl>
      <p className={cn("flex items-start gap-1.5 text-sm", v.tone === "error" ? "text-destructive" : "text-muted-foreground")}>
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span className="break-words">{v.text}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={test} disabled={busy} aria-busy={testing}>
          <Plug /> {testing ? "Testando…" : "Testar conexão"}
        </Button>
        <Button variant="outline" size="sm" onClick={toggle} disabled={busy}>
          <Power /> {a.isActive ? "Desativar" : "Ativar"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={busy}>
          <Pencil /> Editar
        </Button>
        <Button variant="outline" size="sm" className="text-destructive" onClick={() => { setDelError(undefined); setConfirmDel(true); }} disabled={busy}>
          <Trash2 /> Excluir
        </Button>
      </div>
      {editing && <EmailAccountFormDialog mode="edit" account={a} open={editing} onOpenChange={setEditing} />}
      <ConfirmDialog
        open={confirmDel}
        onOpenChange={setConfirmDel}
        title="Excluir conta de e-mail?"
        description={`"${a.email}" será removida permanentemente e deixará de enviar mensagens. Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        destructive
        pending={pending}
        error={delError}
        onConfirm={remove}
      />
    </Card>
  );
}
