"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { Field } from "@/components/campaigns/Field";
import { OptionSelect } from "@/components/campaigns/OptionSelect";
import { fieldError } from "@/components/campaigns/form-utils";
import { ChannelBadge } from "@/components/domain/ChannelBadge";
import { CHANNELS, CHANNEL_LABELS, type ChannelKey } from "@/lib/domain";
import { createTemplate, deleteTemplate, previewTemplate, updateTemplate, type TemplatePreview } from "@/lib/actions/template";
import type { ActionResult, FieldErrors } from "@/lib/actions/result";
import { TEMPLATE_VARIABLES } from "@/lib/templates/render";

export interface TemplateRow {
  id: string;
  name: string;
  channel: ChannelKey;
  subject: string | null;
  body: string;
  usedInSteps: number;
}

const MAX_BODY = 5000;
const CHANNEL_OPTIONS = CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] }));

function TemplateForm({ campaignId, template, onDone }: { campaignId: string; template?: TemplateRow; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = React.useState(template?.name ?? "");
  const [channel, setChannel] = React.useState<string | null>(template?.channel ?? "email");
  const [subject, setSubject] = React.useState(template?.subject ?? "");
  const [body, setBody] = React.useState(template?.body ?? "");
  const [preview, setPreview] = React.useState<TemplatePreview | null>(null);
  const [previewing, startPreview] = React.useTransition();
  const [localErrors, setLocalErrors] = React.useState<FieldErrors | undefined>();
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const subjectRef = React.useRef<HTMLInputElement>(null);
  const lastFocus = React.useRef<"body" | "subject">("body");
  const isEmail = channel === "email";

  const payload = () => ({ campaignId, channel, name, subject: isEmail ? subject : null, body });

  const [state, action, pending] = React.useActionState(async (): Promise<ActionResult<{ id: string }>> => {
    setLocalErrors(undefined);
    return template ? updateTemplate({ ...payload(), id: template.id }) : createTemplate(payload());
  }, null);

  React.useEffect(() => {
    if (state?.ok) {
      toast.success(template ? "Template atualizado." : "Template criado.");
      router.refresh();
      onDone();
    }
  }, [state, template, router, onDone]);

  const errors: FieldErrors | undefined = localErrors ?? (state && !state.ok ? state.errors : undefined);

  function insertVar(v: string) {
    const token = `{{${v}}}`;
    const useSubject = isEmail && lastFocus.current === "subject";
    const el = useSubject ? subjectRef.current : bodyRef.current;
    const value = useSubject ? subject : body;
    const set = useSubject ? setSubject : setBody;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    set(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function runPreview() {
    setLocalErrors(undefined);
    startPreview(async () => {
      const r = await previewTemplate(payload());
      if (r.ok) setPreview(r.data);
      else {
        setPreview(null);
        setLocalErrors(r.errors);
      }
    });
  }

  const formError = fieldError(errors, "_form") ?? fieldError(errors, "campaignId");
  const locked = (template?.usedInSteps ?? 0) > 0;
  const over = body.length > MAX_BODY;

  return (
    <Card className="p-5">
      <form
        action={action}
        className="space-y-4"
        noValidate
      >
        <h3 className="font-heading text-base font-semibold">{template ? "Editar template" : "Novo template"}</h3>
        {formError && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <Field id="t-name" label="Nome" required error={fieldError(errors, "name")}>
            {(a) => <Input {...a} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field
            id="t-channel"
            label="Canal"
            required
            error={fieldError(errors, "channel")}
            hint={locked ? "Bloqueado: o template é usado em passos." : undefined}
          >
            {(a) => (
              <OptionSelect
                id={a.id}
                value={channel}
                onChange={setChannel}
                options={CHANNEL_OPTIONS}
                placeholder="Canal"
                disabled={locked}
                invalid={a["aria-invalid"]}
                describedBy={a["aria-describedby"]}
              />
            )}
          </Field>
        </div>

        {isEmail && (
          <Field id="t-subject" label="Assunto" required error={fieldError(errors, "subject")}>
            {(a) => (
              <Input
                {...a}
                ref={subjectRef}
                value={subject}
                maxLength={200}
                onFocus={() => (lastFocus.current = "subject")}
                onChange={(e) => setSubject(e.target.value)}
              />
            )}
          </Field>
        )}

        <div className="space-y-2">
          <Field id="t-body" label="Mensagem" required error={fieldError(errors, "body")}>
            {(a) => (
              <textarea
                {...a}
                ref={bodyRef}
                rows={8}
                value={body}
                onFocus={() => (lastFocus.current = "body")}
                onChange={(e) => setBody(e.target.value)}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-[3px] focus:ring-primary/20 aria-invalid:border-destructive aria-invalid:ring-destructive/20"
              />
            )}
          </Field>
          <p className={`text-right text-xs ${over ? "text-destructive" : "text-muted-foreground"}`} aria-live="polite">
            {body.length}/{MAX_BODY} caracteres
          </p>
          <div>
            <p id="t-vars" className="mb-1.5 text-xs font-medium text-muted-foreground">
              Inserir variável {isEmail ? "(no campo em foco)" : ""}
            </p>
            <div role="group" aria-labelledby="t-vars" className="flex flex-wrap gap-1.5">
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVar(v)}
                  className="inline-flex h-8 items-center rounded-full border border-border px-3 font-mono text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {preview && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm" aria-live="polite">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Pré-visualização (lead de exemplo)</p>
            {preview.subject && <p className="mb-1 font-medium">{preview.subject}</p>}
            <p className="whitespace-pre-wrap break-words">{preview.body}</p>
            <p className="mt-1 text-xs text-muted-foreground">{preview.length} caracteres renderizados.</p>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancelar
          </Button>
          <Button type="button" variant="outline" onClick={runPreview} disabled={previewing || pending}>
            {previewing ? "Gerando…" : "Pré-visualizar"}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando…" : template ? "Salvar template" : "Criar template"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function TemplateManager({ campaignId, templates }: { campaignId: string; templates: TemplateRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<TemplateRow | "new" | null>(null);
  const [toDelete, setToDelete] = React.useState<TemplateRow | null>(null);
  const [error, setError] = React.useState<string>();
  const [pending, start] = React.useTransition();
  const done = React.useCallback(() => setEditing(null), []);

  function remove() {
    if (!toDelete) return;
    start(async () => {
      const r = await deleteTemplate(toDelete.id);
      if (r.ok) {
        toast.success("Template excluído.");
        setToDelete(null);
        router.refresh();
      } else setError(Object.values(r.errors).flat()[0] ?? "Não foi possível excluir.");
    });
  }

  return (
    <div className="space-y-4">
      {editing ? (
        <TemplateForm
          key={editing === "new" ? "new" : editing.id}
          campaignId={campaignId}
          template={editing === "new" ? undefined : editing}
          onDone={done}
        />
      ) : (
        <Button onClick={() => setEditing("new")}>
          <Plus /> Novo template
        </Button>
      )}

      {templates.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Esta campanha ainda não tem templates.</Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {templates.map((t) => (
            <li key={t.id}>
              <Card className="flex h-full flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate font-medium">{t.name}</p>
                  <ChannelBadge channel={t.channel} />
                </div>
                {t.subject && <p className="truncate text-sm font-medium text-muted-foreground">{t.subject}</p>}
                <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{t.body}</p>
                <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                  <span className="text-xs text-muted-foreground">
                    {t.usedInSteps === 0 ? "Sem uso" : `Usado em ${t.usedInSteps} passo${t.usedInSteps === 1 ? "" : "s"}`}
                  </span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Editar template ${t.name}`} onClick={() => setEditing(t)}>
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Excluir template ${t.name}`}
                      onClick={() => {
                        setError(undefined);
                        setToDelete(t);
                      }}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Excluir template?"
        description={`"${toDelete?.name ?? ""}" será excluído permanentemente. Templates usados em sequências não podem ser excluídos.`}
        confirmLabel="Excluir"
        destructive
        pending={pending}
        error={error}
        onConfirm={remove}
      />
    </div>
  );
}
