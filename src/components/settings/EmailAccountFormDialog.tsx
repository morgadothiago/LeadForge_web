"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Plus } from "lucide-react";
import { toast } from "sonner";
import { notifyActionError } from "@/components/feedback/notify";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { OptionSelect } from "@/components/campaigns/OptionSelect";
import { applyServerErrors } from "@/components/org/org-format";
import { createEmailAccount, updateEmailAccount } from "@/lib/actions/email";
import type { ActionResult } from "@/lib/actions/result";
import { emailAccountCreateSchema, emailAccountUpdateSchema } from "@/lib/schemas/email";
import { PROVIDER_PRESETS, getPreset } from "./email-presets";

export interface EmailAccountFormValues {
  id: string;
  provider: string;
  smtpHost: string;
  port: number;
  email: string;
  fromName: string | null;
  dailyLimit: number;
  hasPassword: boolean;
}

interface Props {
  mode: "create" | "edit";
  account?: EmailAccountFormValues;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  /** SPEC-065b: plano no limite => botao de criar desabilitado, ligado (aria-describedby) ao aviso `LimitNotice`; a barreira real e a action. */
  createDisabled?: boolean;
  createDescribedBy?: string;
}

export function EmailAccountFormDialog({ mode, account, open, onOpenChange, createDisabled, createDescribedBy }: Props) {
  const [inner, setInner] = React.useState(false);
  const isOpen = open ?? inner;
  const setOpen = onOpenChange ?? setInner;
  return (
    <>
      {mode === "create" && (
        <Button onClick={() => setOpen(true)} disabled={createDisabled} aria-describedby={createDisabled ? createDescribedBy : undefined}>
          <Plus /> Nova conta
        </Button>
      )}
      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "Nova conta de e-mail" : "Editar conta de e-mail"}</DialogTitle>
            <DialogDescription>Dados de SMTP da conta que enviará as mensagens.</DialogDescription>
          </DialogHeader>
          <AccountForm mode={mode} account={account} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Estado do formulário RHF (SPEC-045): strings puras, exatamente o que os inputs produzem. A normalização/coerção
 * (trim, lowercase, número) é do schema do servidor (`emailAccount*Schema`) — fonte única de validação.
 */
interface EmailFormState {
  provider: string;
  smtpHost: string;
  port: string;
  email: string;
  fromName: string;
  password: string;
  dailyLimit: string;
}

type EmailSubmit = z.output<typeof emailAccountCreateSchema> | z.output<typeof emailAccountUpdateSchema>;

const EMAIL_FIELDS = ["provider", "smtpHost", "port", "email", "fromName", "password", "dailyLimit"] as const;

function AccountForm({ mode, account, onDone }: { mode: "create" | "edit"; account?: EmailAccountFormValues; onDone: () => void }) {
  const router = useRouter();
  const uid = React.useId();
  const [showPw, setShowPw] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const accountId = account?.id;

  const resolver = React.useMemo(
    () =>
      mode === "edit" && accountId
        ? zodResolver(z.preprocess((v: EmailFormState) => ({ ...v, id: accountId }), emailAccountUpdateSchema))
        : zodResolver(z.preprocess((v: EmailFormState) => v, emailAccountCreateSchema)),
    [mode, accountId],
  );

  const { register, handleSubmit, watch, setValue, setError, setFocus, getValues, formState } = useForm<EmailFormState, unknown, EmailSubmit>({
    resolver,
    defaultValues: {
      provider: account?.provider ?? "gmail",
      smtpHost: account?.smtpHost ?? getPreset("gmail").smtpHost,
      port: String(account?.port ?? getPreset("gmail").port),
      email: account?.email ?? "",
      fromName: account?.fromName ?? "",
      password: "",
      dailyLimit: String(account?.dailyLimit ?? 50),
    },
  });
  const { errors } = formState;
  const provider = watch("provider");

  const options = React.useMemo(() => {
    const base = PROVIDER_PRESETS.map((p) => ({ value: p.value, label: p.label }));
    return account && !base.some((o) => o.value === account.provider) ? [...base, { value: account.provider, label: account.provider }] : base;
  }, [account]);

  function onProvider(v: string | null) {
    if (!v) return;
    setValue("provider", v);
    const p = PROVIDER_PRESETS.find((x) => x.value === v);
    if (p && p.smtpHost) {
      setValue("smtpHost", p.smtpHost);
      setValue("port", String(p.port));
    }
  }

  const onSubmit = handleSubmit(() => {
    // Envia os valores crus do formulário (a action revalida/normaliza com o mesmo schema).
    const raw = getValues();
    startTransition(async () => {
      const r: ActionResult<{ id: string }> =
        mode === "edit" && accountId ? await updateEmailAccount({ id: accountId, ...raw }) : await createEmailAccount(raw);
      if (r.ok) {
        toast.success(mode === "create" ? "Conta adicionada." : "Conta atualizada.");
        onDone();
        router.refresh();
        return;
      }
      notifyActionError(r.errors, applyServerErrors(r.errors, setError, setFocus, EMAIL_FIELDS));
    });
  });

  const preset = getPreset(provider);

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {errors.root?.message && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <Field id={`${uid}-from`} label="Nome do remetente" error={errors.fromName?.message}>
        {(a) => <Input {...a} {...register("fromName")} maxLength={120} autoComplete="off" />}
      </Field>
      <Field id={`${uid}-email`} label="E-mail" required error={errors.email?.message}>
        {(a) => <Input {...a} {...register("email")} type="email" inputMode="email" autoComplete="off" />}
      </Field>
      <Field id={`${uid}-prov`} label="Provedor" required error={errors.provider?.message}>
        {(a) => (
          <OptionSelect id={a.id} value={provider} onChange={onProvider} options={options} placeholder="Selecione" invalid={a["aria-invalid"]} describedBy={a["aria-describedby"]} />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field id={`${uid}-host`} label="Host SMTP" required error={errors.smtpHost?.message}>
          {(a) => <Input {...a} {...register("smtpHost")} placeholder="smtp.exemplo.com" autoComplete="off" />}
        </Field>
        <Field id={`${uid}-port`} label="Porta" required error={errors.port?.message}>
          {(a) => <Input {...a} {...register("port")} type="number" inputMode="numeric" min={1} max={65535} />}
        </Field>
      </div>
      <Field
        id={`${uid}-pw`}
        label="Senha"
        required={mode === "create"}
        error={errors.password?.message}
        hint={
          mode === "edit" && account?.hasPassword
            ? "Deixe em branco para manter a atual."
            : preset.appPassword
              ? "Use uma senha de app (não a senha da sua conta)."
              : undefined
        }
      >
        {(a) => (
          <div className="flex gap-2">
            <Input {...a} {...register("password")} type={showPw ? "text" : "password"} autoComplete="new-password" maxLength={512} />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label={showPw ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={showPw}
              onClick={() => setShowPw((v) => !v)}
            >
              {showPw ? <EyeOff /> : <Eye />}
            </Button>
          </div>
        )}
      </Field>
      {mode === "edit" && preset.appPassword && <p className="-mt-2 text-xs text-muted-foreground">Gmail/Outlook exigem senha de app ao trocar a senha.</p>}
      <Field
        id={`${uid}-limit`}
        label="Limite diário de envios"
        required
        error={errors.dailyLimit?.message}
        hint="Comece baixo (ex.: 20–50) e aumente aos poucos para aquecer a conta e evitar bloqueios por spam."
      >
        {(a) => <Input {...a} {...register("dailyLimit")} type="number" inputMode="numeric" min={1} max={2000} />}
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
