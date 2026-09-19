"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { OptionSelect } from "@/components/campaigns/OptionSelect";
import { fieldError } from "@/components/campaigns/form-utils";
import { createLead, updateLead } from "@/lib/actions/lead";
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
  const uid = React.useId();
  const [campaignId, setCampaignId] = React.useState<string | null>(campaigns[0]?.id ?? null);
  const [phone, setPhone] = React.useState(formatPhone(lead?.phone ?? null));
  const [clientErrors, setClientErrors] = React.useState<FieldErrors | undefined>();

  const [state, action, pending] = React.useActionState(async (_prev: ActionResult<{ id: string; suppressed?: boolean }> | null, fd: FormData) => {
    const g = (k: string) => String(fd.get(k) ?? "");
    const email = g("email").trim();
    const ph = g("phone").trim();
    if (!email && !ph) {
      const msg = "Informe e-mail ou telefone.";
      setClientErrors({ email: [msg], phone: [msg] });
      return null;
    }
    setClientErrors(undefined);
    const base = { name: g("name"), company: g("company"), email, phone: ph, website: g("website"), linkedin: g("linkedin"), source: g("source") };
    return mode === "edit" && lead
      ? updateLead({ leadId: lead.id, ...base })
      : createLead({ campaignId: campaignId ?? "", ...base, source: base.source || undefined });
  }, null);

  React.useEffect(() => {
    if (state?.ok) {
      toast.success(mode === "create" ? "Lead criado." : "Lead atualizado.");
      if (state.data.suppressed) {
        toast.warning("Lead salvo, mas NÃO receberá envios: o e-mail ou telefone está na lista de supressão.", { duration: 12000 });
      }
      onDone();
      if (mode === "create") router.push(`/leads/${state.data.id}`);
      else router.refresh();
    }
  }, [state, mode, router, onDone]);

  const errors = clientErrors ?? (state && !state.ok ? state.errors : undefined);
  const formError = fieldError(errors, "_form");
  const t = (k: string, def: string | null | undefined) => ({ name: k, defaultValue: def ?? "" });

  return (
    <form action={action} className="grid gap-4" noValidate>
      {formError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}
      {mode === "create" && (
        <Field id={`${uid}-camp`} label="Campanha" required error={fieldError(errors, "campaignId")}>
          {(a) => (
            <OptionSelect id={a.id} value={campaignId} onChange={setCampaignId} options={campaigns.map((c) => ({ value: c.id, label: c.name }))} placeholder="Selecione" invalid={a["aria-invalid"]} describedBy={a["aria-describedby"]} />
          )}
        </Field>
      )}
      <Field id={`${uid}-name`} label="Nome" required error={fieldError(errors, "name")}>
        {(a) => <Input {...a} {...t("name", lead?.name)} maxLength={200} autoComplete="off" />}
      </Field>
      <Field id={`${uid}-company`} label="Empresa" error={fieldError(errors, "company")}>
        {(a) => <Input {...a} {...t("company", lead?.company)} maxLength={200} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${uid}-email`} label="E-mail" error={fieldError(errors, "email")}>
          {(a) => <Input {...a} {...t("email", lead?.email)} type="email" inputMode="email" autoComplete="off" />}
        </Field>
        <Field id={`${uid}-phone`} label="Telefone (celular)" hint="DDD + 9 + 8 dígitos, ex.: (11) 91234-5678" error={fieldError(errors, "phone")}>
          {(a) => (
            <Input {...a} name="phone" type="tel" inputMode="tel" placeholder="(11) 91234-5678" value={phone} onChange={(e) => setPhone(maskBrPhone(e.target.value))} />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${uid}-site`} label="Site" error={fieldError(errors, "website")}>
          {(a) => <Input {...a} {...t("website", lead?.website)} inputMode="url" placeholder="https://" />}
        </Field>
        <Field id={`${uid}-li`} label="LinkedIn" error={fieldError(errors, "linkedin")}>
          {(a) => <Input {...a} {...t("linkedin", lead?.linkedin)} inputMode="url" placeholder="https://linkedin.com/in/…" />}
        </Field>
      </div>
      <Field id={`${uid}-src`} label="Origem" error={fieldError(errors, "source")}>
        {(a) => <Input {...a} {...t("source", lead?.source ?? (mode === "create" ? "manual" : ""))} maxLength={100} />}
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
