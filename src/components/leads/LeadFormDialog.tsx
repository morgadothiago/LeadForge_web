"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, type FieldPath, type SubmitErrorHandler } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { OptionSelect } from "@/components/campaigns/OptionSelect";
import { getFormError } from "@/components/campaigns/form-utils";
import { createLead, updateLead } from "@/lib/actions/lead";
import { createLeadSchema, updateLeadSchema, MIN_CONTACT_MSG } from "@/lib/schemas/lead";
import type { ActionResult, FieldErrors } from "@/lib/actions/result";
import { formatPhone, maskBrPhone } from "./lead-format";

export interface LeadFormValues {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  linkedin: string | null;
  source: string | null;
}

/**
 * Estado do formulário RHF (SPEC-043): precisa ser EXATAMENTE `z.input<createLeadSchema>` —
 * qualquer structura "parecida" quebra a atribuição do `resolver` (variância de ResolverOptions).
 * Strings puras; normalização (e-mail/telefone/URL) é do schema.
 */
type LeadFormState = z.input<typeof createLeadSchema>;

/** Regra de contato do servidor (create via `.refine` do schema; update via checagem da action) espelhada no client — mesma mensagem. */
const clientUpdateLeadSchema = updateLeadSchema.superRefine((v, ctx) => {
  if (!v.email && !v.phone) ctx.addIssue({ code: "custom", path: ["email"], message: MIN_CONTACT_MSG });
});

type LeadSubmit = z.output<typeof createLeadSchema> | z.output<typeof clientUpdateLeadSchema>;

interface Props {
  mode: "create" | "edit";
  lead?: LeadFormValues;
  campaigns?: { id: string; name: string }[];
  /** Controlado externamente (edição); no modo create o botão "Novo lead" é renderizado. */
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}

export function LeadFormDialog({ mode, lead, campaigns = [], open, onOpenChange }: Props) {
  const [inner, setInner] = React.useState(false);
  const isOpen = open ?? inner;
  const setOpen = onOpenChange ?? setInner;
  return (
    <>
      {mode === "create" && (
        <Button onClick={() => setOpen(true)}>
          <Plus /> Novo lead
        </Button>
      )}
      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "Novo lead" : "Editar lead"}</DialogTitle>
            <DialogDescription>Informe pelo menos um contato: e-mail ou telefone (celular BR).</DialogDescription>
          </DialogHeader>
          <LeadForm mode={mode} lead={lead} campaigns={campaigns} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function LeadForm({ mode, lead, campaigns, onDone }: { mode: "create" | "edit"; lead?: LeadFormValues; campaigns: { id: string; name: string }[]; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const leadId = lead?.id;

  const resolver = React.useMemo(
    () =>
      mode === "edit" && leadId
        ? zodResolver(
            z.preprocess((v: LeadFormState) => {
              // "Origem" vazia = inalterada (o form original fazia `source || undefined`; limpar a
              // origem nao faz sentido — ela registra a captacao do lead).
              return { ...v, leadId, source: v.source || undefined };
            }, clientUpdateLeadSchema),
          )
        : zodResolver(createLeadSchema),
    [mode, leadId],
  );

  const { register, handleSubmit, control, watch, setValue, setError, setFocus, formState } = useForm<LeadFormState, unknown, LeadSubmit>({
    resolver,
    defaultValues: {
      campaignId: campaigns[0]?.id ?? "",
      name: lead?.name ?? "",
      company: lead?.company ?? "",
      email: lead?.email ?? "",
      phone: formatPhone(lead?.phone ?? null),
      website: lead?.website ?? "",
      linkedin: lead?.linkedin ?? "",
      source: lead?.source ?? (mode === "create" ? "manual" : ""),
    },
  });
  const { errors } = formState;

  function applyServerErrors(errs: FieldErrors) {
    let first: FieldPath<LeadFormState> | undefined;
    for (const [key, msgs] of Object.entries(errs)) {
      if (key === "_form") continue;
      const path = key as FieldPath<LeadFormState>;
      first ??= path;
      setError(path, { type: "server", message: msgs.join(" ") });
    }
    if (errs._form) setError("root", { type: "server", message: errs._form.join(" ") });
    toast.error(getFormError(errs));
    if (first) setFocus(first.replace(/\.\d+$/, "") as FieldPath<LeadFormState>);
  }
  const campaignId = watch("campaignId");

  // Padrão SPEC-042: "ao menos um contato" aparece nos DOIS campos (e-mail e telefone), como no clientErrors manual antigo.
  const onError: SubmitErrorHandler<LeadFormState> = (errs) => {
    if (errs.email?.message === MIN_CONTACT_MSG) setError("phone", { type: "client", message: MIN_CONTACT_MSG });
  };

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const r: ActionResult<{ id: string; suppressed?: boolean }> =
        mode === "edit" && leadId ? await updateLead(values) : await createLead(values);
      if (r.ok) {
        toast.success(mode === "create" ? "Lead criado." : "Lead atualizado.");
        if (r.data.suppressed) {
          toast.warning("Lead salvo, mas NÃO receberá envios: o e-mail ou telefone está na lista de supressão.", { duration: 12000 });
        }
        onDone();
        if (mode === "create") router.push(`/leads/${r.data.id}`);
        else router.refresh();
        return;
      }
      applyServerErrors(r.errors);
    });
  }, onError);

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {errors.root?.message && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      {mode === "create" && (
        <Field id="lead-camp" label="Campanha" required error={errors.campaignId?.message}>
          {(a) => (
            <OptionSelect
              id={a.id}
              value={campaignId || null}
              onChange={(v) => setValue("campaignId", v ?? "")}
              options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Selecione"
              invalid={a["aria-invalid"]}
              describedBy={a["aria-describedby"]}
            />
          )}
        </Field>
      )}
      <Field id="lead-name" label="Nome" required error={errors.name?.message}>
        {(a) => <Input {...a} {...register("name")} maxLength={200} autoComplete="off" />}
      </Field>
      <Field id="lead-company" label="Empresa" error={errors.company?.message}>
        {(a) => <Input {...a} {...register("company")} maxLength={200} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="lead-email" label="E-mail" error={errors.email?.message}>
          {(a) => <Input {...a} {...register("email")} type="email" inputMode="email" autoComplete="off" />}
        </Field>
        <Field id="lead-phone" label="Telefone (celular)" hint="DDD + 9 + 8 dígitos, ex.: (11) 91234-5678" error={errors.phone?.message}>
          {(a) => (
            <Controller
              control={control}
              name="phone"
              render={({ field }) => (
                <Input
                  {...a}
                  {...field}
                  value={field.value ?? ""}
                  type="tel"
                  inputMode="tel"
                  placeholder="(11) 91234-5678"
                  onChange={(e) => field.onChange(maskBrPhone(e.target.value))}
                />
              )}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="lead-site" label="Site" error={errors.website?.message}>
          {(a) => <Input {...a} {...register("website")} inputMode="url" placeholder="https://" />}
        </Field>
        <Field id="lead-li" label="LinkedIn" error={errors.linkedin?.message}>
          {(a) => <Input {...a} {...register("linkedin")} inputMode="url" placeholder="https://linkedin.com/in/…" />}
        </Field>
      </div>
      <Field id="lead-src" label="Origem" error={errors.source?.message}>
        {(a) => <Input {...a} {...register("source")} maxLength={100} />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
