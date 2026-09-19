"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { OptionSelect } from "@/components/campaigns/OptionSelect";
import { fieldError } from "@/components/campaigns/form-utils";
import { createEmailAccount, updateEmailAccount } from "@/lib/actions/email";
import type { ActionResult } from "@/lib/actions/result";
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
}

export function EmailAccountFormDialog({ mode, account, open, onOpenChange }: Props) {
  const [inner, setInner] = React.useState(false);
  const isOpen = open ?? inner;
  const setOpen = onOpenChange ?? setInner;
  return (
    <>
      {mode === "create" && (
        <Button onClick={() => setOpen(true)}>
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

function AccountForm({ mode, account, onDone }: { mode: "create" | "edit"; account?: EmailAccountFormValues; onDone: () => void }) {
  const router = useRouter();
  const uid = React.useId();
  const [provider, setProvider] = React.useState<string>(account?.provider ?? "gmail");
  const [host, setHost] = React.useState(account?.smtpHost ?? getPreset("gmail").smtpHost);
  const [port, setPort] = React.useState(String(account?.port ?? getPreset("gmail").port));
  const [showPw, setShowPw] = React.useState(false);

  const options = React.useMemo(() => {
    const base = PROVIDER_PRESETS.map((p) => ({ value: p.value, label: p.label }));
    return account && !base.some((o) => o.value === account.provider) ? [...base, { value: account.provider, label: account.provider }] : base;
  }, [account]);

  function onProvider(v: string | null) {
    if (!v) return;
    setProvider(v);
    const p = PROVIDER_PRESETS.find((x) => x.value === v);
    if (p && p.smtpHost) {
      setHost(p.smtpHost);
      setPort(String(p.port));
    }
  }

  const [state, action, pending] = React.useActionState(async (_prev: ActionResult<{ id: string }> | null, fd: FormData) => {
    const g = (k: string) => String(fd.get(k) ?? "");
    const base = { provider, smtpHost: g("smtpHost"), port: g("port"), email: g("email"), fromName: g("fromName"), dailyLimit: g("dailyLimit") };
    return mode === "edit" && account
      ? updateEmailAccount({ id: account.id, ...base, password: g("password") })
      : createEmailAccount({ ...base, password: g("password") });
  }, null);

  React.useEffect(() => {
    if (state?.ok) {
      toast.success(mode === "create" ? "Conta adicionada." : "Conta atualizada.");
      onDone();
      router.refresh();
    }
  }, [state, mode, router, onDone]);

  const errors = state && !state.ok ? state.errors : undefined;
  const formError = fieldError(errors, "_form");
  const preset = getPreset(provider);

  return (
    <form action={action} className="grid gap-4" noValidate>
      {formError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}
      <Field id={`${uid}-from`} label="Nome do remetente" error={fieldError(errors, "fromName")}>
        {(a) => <Input {...a} name="fromName" defaultValue={account?.fromName ?? ""} maxLength={120} autoComplete="off" />}
      </Field>
      <Field id={`${uid}-email`} label="E-mail" required error={fieldError(errors, "email")}>
        {(a) => <Input {...a} name="email" type="email" inputMode="email" defaultValue={account?.email ?? ""} autoComplete="off" />}
      </Field>
      <Field id={`${uid}-prov`} label="Provedor" required error={fieldError(errors, "provider")}>
        {(a) => (
          <OptionSelect id={a.id} value={provider} onChange={onProvider} options={options} placeholder="Selecione" invalid={a["aria-invalid"]} describedBy={a["aria-describedby"]} />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field id={`${uid}-host`} label="Host SMTP" required error={fieldError(errors, "smtpHost")}>
          {(a) => <Input {...a} name="smtpHost" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.exemplo.com" autoComplete="off" />}
        </Field>
        <Field id={`${uid}-port`} label="Porta" required error={fieldError(errors, "port")}>
          {(a) => <Input {...a} name="port" type="number" inputMode="numeric" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />}
        </Field>
      </div>
      <Field
        id={`${uid}-pw`}
        label="Senha"
        required={mode === "create"}
        error={fieldError(errors, "password")}
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
            <Input {...a} name="password" type={showPw ? "text" : "password"} autoComplete="new-password" defaultValue="" maxLength={512} />
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
        error={fieldError(errors, "dailyLimit")}
        hint="Comece baixo (ex.: 20–50) e aumente aos poucos para aquecer a conta e evitar bloqueios por spam."
      >
        {(a) => <Input {...a} name="dailyLimit" type="number" inputMode="numeric" min={1} max={2000} defaultValue={account?.dailyLimit ?? 50} />}
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
