"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldPath } from "react-hook-form";
import { z } from "zod";
import { Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { Field } from "@/components/campaigns/Field";
import { OptionSelect } from "@/components/campaigns/OptionSelect";
import { getFormError } from "@/components/campaigns/form-utils";
import { ChannelBadge } from "@/components/domain/ChannelBadge";
import { CHANNELS, CHANNEL_LABELS, type ChannelKey } from "@/lib/domain";
import { createTemplate, deleteTemplate, previewTemplate, updateTemplate, type TemplatePreview } from "@/lib/actions/template";
import type { FieldErrors } from "@/lib/actions/result";
import { templateCreateSchema, templateUpdateSchema } from "@/lib/schemas/template";
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

/** Valores do formulário (SPEC-044). `subject` vive como texto e vira `null` fora do e-mail no submit. */
interface TemplateFormValues {
  name: string;
  channel: ChannelKey;
  subject: string;
  body: string;
}

type TemplateSubmit = z.output<typeof templateCreateSchema> | z.output<typeof templateUpdateSchema>;

function TemplateForm({ campaignId, template, onDone }: { campaignId: string; template?: TemplateRow; onDone: () => void }) {
  const router = useRouter();
  const [preview, setPreview] = React.useState<TemplatePreview | null>(null);
  const [previewing, startPreview] = React.useTransition();
  const [pending, startTransition] = React.useTransition();
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const subjectRef = React.useRef<HTMLInputElement>(null);
  const lastFocus = React.useRef<"body" | "subject">("body");

  // `subject: null` fora do e-mail espelha o `payload()` original — sem isso o refine "Assunto só é permitido
  // para e-mail." dispararia ao trocar o canal com um assunto digitado.
  const resolver = React.useMemo(
    () =>
      zodResolver(
        z.preprocess(
          (v: TemplateFormValues) => ({
            campaignId,
            channel: v.channel,
            name: v.name,
            subject: v.channel === "email" ? v.subject : null,
            body: v.body,
            ...(template ? { id: template.id } : {}),
          }),
          template ? templateUpdateSchema : templateCreateSchema,
        ),
      ),
    [campaignId, template],
  );

  const { register, handleSubmit, watch, getValues, setValue, setError, setFocus, clearErrors, formState } = useForm<
    TemplateFormValues,
    unknown,
    TemplateSubmit
  >({
    resolver,
    defaultValues: { name: template?.name ?? "", channel: template?.channel ?? "email", subject: template?.subject ?? "", body: template?.body ?? "" },
  });
  const { errors } = formState;

  const channel = watch("channel");
  const body = watch("body");
  const isEmail = channel === "email";
  const locked = (template?.usedInSteps ?? 0) > 0;
  const over = body.length > MAX_BODY;

  const subjectReg = register("subject");
  const bodyReg = register("body");

  /** Erros vindos do server (ActionResult). `campaignId` não é campo do form: cai no banner (mesmo lugar do legado). */
  function applyServerErrors(errs: FieldErrors) {
    clearErrors();
    let first: FieldPath<TemplateFormValues> | undefined;
    for (const [key, msgs] of Object.entries(errs)) {
      if (key === "_form" || key === "campaignId") continue;
      const path = key as FieldPath<TemplateFormValues>;
      first ??= path;
      setError(path, { type: "server", message: msgs.join(" ") });
    }
    const banner = [errs._form, errs.campaignId].flatMap((m) => m ?? []).join(" ");
    if (banner) setError("root", { type: "server", message: banner });
    toast.error(getFormError(errs));
    if (first) setFocus(first as FieldPath<TemplateFormValues>);
  }

  /** Falha da pré-visualização: só erros em campo/banner, sem toast (comportamento original). */
  function applyPreviewErrors(errs: FieldErrors) {
    clearErrors();
    for (const [key, msgs] of Object.entries(errs)) {
      if (key === "_form" || key === "campaignId") continue;
      setError(key as FieldPath<TemplateFormValues>, { type: "server", message: msgs.join(" ") });
    }
    const banner = [errs._form, errs.campaignId].flatMap((m) => m ?? []).join(" ");
    if (banner) setError("root", { type: "server", message: banner });
  }

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const r = template ? await updateTemplate(values) : await createTemplate(values);
      if (!r.ok) {
        applyServerErrors(r.errors);
        return;
      }
      toast.success(template ? "Template atualizado." : "Template criado.");
      if (r.data.warnings.length > 0) {
        toast.warning(`Template salvo com ${r.data.warnings.length} aviso${r.data.warnings.length === 1 ? "" : "s"}: ${r.data.warnings.join(" ")}`, { duration: 15000 });
      }
      router.refresh();
      onDone();
    });
  });

  function insertVar(v: string) {
    const token = `{{${v}}}`;
    const vals = getValues();
    const useSubject = isEmail && lastFocus.current === "subject";
    const el = useSubject ? subjectRef.current : bodyRef.current;
    const value = useSubject ? vals.subject : vals.body;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    setValue(useSubject ? "subject" : "body", value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function runPreview() {
    clearErrors();
    startPreview(async () => {
      const v = getValues();
      const r = await previewTemplate({ campaignId, channel: v.channel, name: v.name, subject: v.channel === "email" ? v.subject : null, body: v.body });
      if (r.ok) setPreview(r.data);
      else {
        setPreview(null);
        applyPreviewErrors(r.errors);
      }
    });
  }

  const formError = errors.root?.message;

  return (
    <Card className="p-5">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <h3 className="font-heading text-base font-semibold">{template ? "Editar template" : "Novo template"}</h3>
        {formError && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <Field id="t-name" label="Nome" required error={errors.name?.message}>
            {(a) => <Input {...a} {...register("name")} maxLength={120} />}
          </Field>
          <Field
            id="t-channel"
            label="Canal"
            required
            error={errors.channel?.message}
            hint={locked ? "Bloqueado: o template é usado em passos." : undefined}
          >
            {(a) => (
              <OptionSelect
                id={a.id}
                value={channel}
                onChange={(v) => v && setValue("channel", v as ChannelKey)}
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
          <Field id="t-subject" label="Assunto" required error={errors.subject?.message}>
            {(a) => (
              <Input
                {...a}
                {...subjectReg}
                ref={(el) => {
                  subjectRef.current = el;
                  subjectReg.ref(el);
                }}
                maxLength={200}
                onFocus={() => (lastFocus.current = "subject")}
              />
            )}
          </Field>
        )}

        <div className="space-y-2">
          <Field id="t-body" label="Mensagem" required error={errors.body?.message}>
            {(a) => (
              <textarea
                {...a}
                {...bodyReg}
                ref={(el) => {
                  bodyRef.current = el;
                  bodyReg.ref(el);
                }}
                rows={8}
                onFocus={() => (lastFocus.current = "body")}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-[3px] focus:ring-primary/20 aria-invalid:border-destructive aria-invalid:ring-destructive/20"
              />
            )}
          </Field>
          {channel === "whatsapp" && (
            <p className="text-xs text-muted-foreground">
              Variações: use <code className="font-mono">{"{oi|olá|e aí}"}</code> para alternar palavras. A variante é sorteada de forma estável por lead (o mesmo lead sempre recebe a mesma), evitando mensagens idênticas em massa. Sem aninhamento.
            </p>
          )}
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

        {preview && preview.warnings && preview.warnings.length > 0 && (
          <div role="status" className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <p className="flex items-center gap-1.5 font-medium">
              <TriangleAlert className="size-4 text-warning" aria-hidden="true" /> Avisos para o primeiro toque de WhatsApp (não bloqueiam o salvamento)
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              {preview.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

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
