"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { fieldError } from "@/components/campaigns/form-utils";
import { maskBrPhone } from "@/components/leads/lead-format";
import { createWhatsAppInstance, updateInstance } from "@/lib/actions/whatsapp";
import type { ActionResult } from "@/lib/actions/result";
import { DAILY_LIMIT_MAX_UI, DAILY_LIMIT_MIN_UI, WARMUP_RAMP, validateDailyLimit } from "./health-format";
import { formatInstanceNumber } from "./whatsapp-format";

export interface InstanceFormValues {
  id: string;
  instanceName: string;
  number: string;
  dailyLimit: number;
}

interface Props {
  mode: "create" | "edit";
  instance?: InstanceFormValues;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  /** create: chamado com o id/nome da instância criada (abre o QR). */
  onCreated?: (created: { id: string; name: string }) => void;
}

export function WhatsAppInstanceFormDialog({ mode, instance, open, onOpenChange, onCreated }: Props) {
  const [inner, setInner] = React.useState(false);
  const isOpen = open ?? inner;
  const setOpen = onOpenChange ?? setInner;
  const close = React.useCallback(() => setOpen(false), [setOpen]);
  return (
    <>
      {mode === "create" && (
        <Button onClick={() => setOpen(true)}>
          <Plus /> Nova instância
        </Button>
      )}
      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "Nova instância de WhatsApp" : "Editar instância"}</DialogTitle>
            <DialogDescription>{mode === "create" ? "Depois de criar, você lerá um QR code para conectar o número." : "Ajuste o número e o limite diário de envios."}</DialogDescription>
          </DialogHeader>
          <InstanceForm mode={mode} instance={instance} onDone={close} onCreated={onCreated} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function InstanceForm({ mode, instance, onDone, onCreated }: { mode: "create" | "edit"; instance?: InstanceFormValues; onDone: () => void; onCreated?: Props["onCreated"] }) {
  const router = useRouter();
  const uid = React.useId();
  const [phone, setPhone] = React.useState(instance ? formatInstanceNumber(instance.number) : "");
  const [name, setName] = React.useState(instance?.instanceName ?? "");

  const [state, action, pending] = React.useActionState(async (_prev: ActionResult<{ id: string }> | null, fd: FormData): Promise<ActionResult<{ id: string }>> => {
    const g = (k: string) => String(fd.get(k) ?? "");
    const limitError = validateDailyLimit(g("dailyLimit"));
    if (limitError) return { ok: false as const, errors: { dailyLimit: [limitError] } };
    if (mode === "edit" && instance) return updateInstance({ id: instance.id, number: g("number"), dailyLimit: g("dailyLimit") });
    return createWhatsAppInstance({ instanceName: g("instanceName"), number: g("number"), dailyLimit: g("dailyLimit") });
  }, null);

  React.useEffect(() => {
    if (state?.ok) {
      toast.success(mode === "create" ? "Instância criada." : "Instância atualizada.");
      onDone();
      router.refresh();
      if (mode === "create") onCreated?.({ id: state.data.id, name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reagir apenas ao resultado da action
  }, [state]);

  const errors = state && !state.ok ? state.errors : undefined;
  const formError = fieldError(errors, "_form");

  return (
    <form action={action} className="grid gap-4" noValidate>
      {formError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}
      <div role="note" className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <p>
          A integração usa Baileys (não oficial): há risco de banimento do número. Use um <strong>chip dedicado</strong> (não o seu pessoal) e comece com poucos envios por dia.
        </p>
      </div>
      {mode === "create" ? (
        <Field id={`${uid}-name`} label="Nome da instância" required error={fieldError(errors, "instanceName")} hint="Único; 3 a 40 caracteres (letras, números, hífen e underline).">
          {(a) => <Input {...a} name="instanceName" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="off" placeholder="vendas-01" />}
        </Field>
      ) : (
        <p className="text-sm">
          <span className="text-muted-foreground">Instância: </span>
          <span className="font-medium">{instance?.instanceName}</span>
        </p>
      )}
      <Field id={`${uid}-num`} label="Número do WhatsApp" required error={fieldError(errors, "number")} hint="Celular brasileiro com DDD. Ex.: (11) 91234-5678.">
        {(a) => <Input {...a} name="number" type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(maskBrPhone(e.target.value))} placeholder="(11) 91234-5678" />}
      </Field>
      <Field
        id={`${uid}-limit`}
        label="Teto diário de mensagens"
        required
        error={fieldError(errors, "dailyLimit")}
        hint={`De ${DAILY_LIMIT_MIN_UI} a ${DAILY_LIMIT_MAX_UI}. Este é o TETO, não o valor de hoje: o envio real segue a rampa de aquecimento abaixo.`}
      >
        {(a) => <Input {...a} name="dailyLimit" type="number" inputMode="numeric" min={DAILY_LIMIT_MIN_UI} max={DAILY_LIMIT_MAX_UI} defaultValue={instance?.dailyLimit ?? 30} />}
      </Field>
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
        <p className="mb-1 font-medium">Aquecimento (limite real por dia desde a 1ª conexão)</p>
        <ul className="grid gap-0.5 text-muted-foreground sm:grid-cols-2">
          {WARMUP_RAMP.map((r) => (
            <li key={r.period}>
              {r.period}: <span className="font-medium text-foreground">{r.limit === "teto" ? "o teto configurado" : `${r.limit}/dia`}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-muted-foreground">Se a saúde do número piorar, a rampa recua e os envios podem ser pausados automaticamente.</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : mode === "create" ? "Criar e conectar" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
