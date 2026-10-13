"use client";
import * as React from "react";
import { KeyRound, ShieldAlert, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { fieldError } from "@/components/campaigns/form-utils";
import { removeOrgIntegrationByAdmin, saveOrgIntegrationByAdmin } from "@/lib/actions/admin/entitlements";
import { formatDateTime } from "@/components/leads/lead-format";
import { REQUIRES_BASE_URL, type IntegrationKindName } from "@/lib/integrations/types";
import type { OrgPolicyView } from "@/lib/queries/admin/org-policy";
import { allowPrivatePayload, initialAllowPrivateHost } from "./policy-format";
import { FormError, ReasonField, Section, useAdminAction } from "./policy-ui";

type Row = OrgPolicyView["integrations"][number];

const KINDS: { kind: IntegrationKindName; title: string; help: string }[] = [
  { kind: "places", title: "Busca de leads (Google Places)", help: "Chave da plataforma usada pela busca de leads desta organização. O cliente não vê nem edita." },
  { kind: "evolution", title: "WhatsApp (Evolution API)", help: "Servidor e chave global da Evolution. O cliente só pareia o próprio número (QR) e vê o status." },
  { kind: "llm", title: "Provedor de IA (LLM)", help: "Chave de IA paga pela plataforma para esta organização. Sem chave por organização, vale o provedor padrão do servidor (variáveis de ambiente)." },
];

/** SPEC-069c — aba "Integrações": grava/gira/remove chaves da PLATAFORMA por organização. Write-only: o valor nunca volta, só o `hint` mascarado. */
export function IntegrationsPolicyTab({ policy }: { policy: OrgPolicyView }) {
  return (
    <div className="space-y-4">
      <p role="note" className="flex gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>As chaves ficam criptografadas e nunca são exibidas depois de salvas: só os últimos caracteres (dica) e o endereço mascarado. Para trocar, grave uma nova chave.</span>
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {KINDS.map((k) => (
          <IntegrationCard key={k.kind} orgId={policy.org.id} kind={k.kind} title={k.title} help={k.help} rows={policy.integrations.filter((r) => r.integration === k.kind)} platformLlmConfigured={policy.platformLlmConfigured} />
        ))}
      </div>
    </div>
  );
}

function IntegrationCard({ orgId, kind, title, help, rows, platformLlmConfigured }: { orgId: string; kind: IntegrationKindName; title: string; help: string; rows: Row[]; platformLlmConfigured: boolean }) {
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [removeRow, setRemoveRow] = React.useState<Row | null>(null);
  const current = rows.find((r) => r.name === "default") ?? rows[0];
  return (
    <Section title={title} description={help}>
      <div className="grid gap-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Badge variant="muted">Não configurada</Badge>{" "}
            {kind === "llm" ? (platformLlmConfigured ? "Usa o provedor padrão do servidor." : "Sem chave por organização e sem provedor padrão no servidor: a IA fica indisponível.") : "A organização não consegue usar este recurso até a chave ser gravada."}
          </p>
        ) : (
          <ul className="grid gap-2">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Badge>{r.managedByPlatform ? "Chave da plataforma" : "Chave do cliente (legada)"}</Badge>
                    {r.lastTestOk === true ? <Badge variant="muted">Teste OK</Badge> : r.lastTestOk === false ? <Badge variant="destructive">Teste falhou</Badge> : null}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">
                    {r.hint ? <span>Chave terminada em <span className="font-mono">{r.hint}</span></span> : <span>Chave sem dica</span>}
                    {r.hostMasked ? <span> · Servidor {r.hostMasked}</span> : null}
                    <span> · Atualizada em {formatDateTime(new Date(r.updatedAt))}</span>
                  </p>
                  {!r.managedByPlatform ? <p className="text-xs text-muted-foreground">Gravar uma nova chave aqui a converte em chave da plataforma.</p> : null}
                </div>
                <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => setRemoveRow(r)} aria-label={`Remover integração ${title}`}>
                  <Trash2 /> Remover
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button type="button" onClick={() => setSaveOpen(true)} className="h-11 w-full sm:h-9 sm:w-auto">
            <KeyRound /> {current ? "Gravar nova chave" : "Gravar chave"}
          </Button>
        </div>
      </div>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Grava a chave como da plataforma para esta organização.</DialogDescription>
          </DialogHeader>
          <SaveForm orgId={orgId} kind={kind} existing={current} onDone={() => setSaveOpen(false)} />
        </DialogContent>
      </Dialog>
      <Dialog open={removeRow !== null} onOpenChange={(o) => !o && setRemoveRow(null)}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Remover integração</DialogTitle>
            <DialogDescription>{title}: a organização perde o recurso até uma nova chave ser gravada.</DialogDescription>
          </DialogHeader>
          {removeRow ? <RemoveForm orgId={orgId} row={removeRow} kind={kind} onDone={() => setRemoveRow(null)} /> : null}
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function SaveForm({ orgId, kind, existing, onDone }: { orgId: string; kind: IntegrationKindName; existing: Row | undefined; onDone: () => void }) {
  const uid = React.useId();
  const needsUrl = REQUIRES_BASE_URL[kind];
  const [value, setValue] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  // B1 (QA 069c): inicia com o valor gravado (nao sensivel) e envia `false` explicito ao desmarcar.
  const [allowPrivate, setAllowPrivate] = React.useState(initialAllowPrivateHost(existing));
  const [reason, setReason] = React.useState("");
  const { run, errors, pending } = useAdminAction();
  const showUrl = needsUrl || kind === "llm";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () => saveOrgIntegrationByAdmin({ orgId, reason, integration: kind, name: "default", value, baseUrl, ...allowPrivatePayload(showUrl, allowPrivate) }),
      "Chave gravada. O valor não é exibido novamente.",
      () => {
        setValue("");
        onDone();
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <FormError errors={errors} />
      <Field id={`${uid}-value`} label="Chave" required={!existing} error={fieldError(errors, "value")} hint={existing ? "Deixe vazio para manter a chave atual (útil só para mudar o endereço)." : "Não pode ser recuperada depois de salva."}>
        {(a) => <Input {...a} type="password" autoComplete="new-password" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} />}
      </Field>
      {showUrl ? (
        <>
          <Field
            id={`${uid}-url`}
            label={needsUrl ? "Endereço do servidor (URL)" : "URL base (opcional, provedor compatível com OpenAI)"}
            required={needsUrl}
            error={fieldError(errors, "baseUrl")}
            hint={kind === "llm" ? "Ao trocar a URL sem informar nova chave, a chave anterior é removida." : existing?.hostMasked ? `Atual: ${existing.hostMasked}. Vazio mantém o atual.` : undefined}
          >
            {(a) => <Input {...a} type="url" inputMode="url" autoComplete="off" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://" />}
          </Field>
          <label htmlFor={`${uid}-priv`} className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
            <input id={`${uid}-priv`} type="checkbox" checked={allowPrivate} onChange={(e) => setAllowPrivate(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
            <span>
              <span className="font-medium">Servidor em rede privada/localhost</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">Marque só se o servidor for da plataforma. Endereços de metadados de nuvem continuam sempre bloqueados.</span>
            </span>
          </label>
        </>
      ) : null}
      <ReasonField id={`${uid}-reason`} value={reason} onChange={setReason} error={fieldError(errors, "reason")} />
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" className="h-11 sm:h-9" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pending} className="h-11 sm:h-9">
          {pending ? "Salvando…" : "Salvar chave"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function RemoveForm({ orgId, row, kind, onDone }: { orgId: string; row: Row; kind: IntegrationKindName; onDone: () => void }) {
  const uid = React.useId();
  const [reason, setReason] = React.useState("");
  const { run, errors, pending } = useAdminAction();
  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(() => removeOrgIntegrationByAdmin({ orgId, reason, id: row.id }), "Integração removida.", onDone);
  }
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <FormError errors={errors} />
      {kind === "evolution" ? <p className="text-xs text-muted-foreground">A Evolution não pode ser removida enquanto houver números de WhatsApp conectados a ela.</p> : null}
      <ReasonField id={`${uid}-reason`} value={reason} onChange={setReason} error={fieldError(errors, "reason")} />
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" className="h-11 sm:h-9" />}>Cancelar</DialogClose>
        <Button type="submit" variant="destructive" disabled={pending} className="h-11 sm:h-9">
          {pending ? "Removendo…" : "Remover integração"}
        </Button>
      </DialogFooter>
    </form>
  );
}
