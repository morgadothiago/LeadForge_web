"use client";
import * as React from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MailCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { getFormError } from "@/components/campaigns/form-utils";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { acceptInvite, signUpAndJoin } from "@/lib/actions/org";
import { inviteSignupFormSchema, type InviteSignupFormInput } from "@/lib/schemas/org";
import { applyServerErrors, maskEmail, roleLabel, type OrgRoleName } from "./org-format";

export type InviteViewState =
  | { kind: "error"; message: string }
  | { kind: "invalid" }
  /** Logado com o e-mail do convite. */
  | { kind: "accept"; orgName: string; email: string; orgRole: OrgRoleName }
  /** Logado com OUTRO e-mail (ou conta que não pode aceitar). */
  | { kind: "wrong-account"; orgName: string; inviteEmail: string; currentEmail: string }
  /** Deslogado, e-mail do convite já tem conta -> login. */
  | { kind: "login"; orgName: string; email: string; orgRole: OrgRoleName }
  /** Deslogado, e-mail novo -> criar conta e entrar. */
  | { kind: "signup"; orgName: string; email: string; orgRole: OrgRoleName };

/**
 * SPEC-049b — corpo da página pública `/convite/[token]`. A decisão do estado é do servidor (página) a partir de
 * `previewInvite` + sessão; aqui só se renderiza e se executam `acceptInvite` / `signUpAndJoin`.
 * `invalid` é GENÉRICO (D-049-8): não distingue inexistente/expirado/usado/revogado.
 */
export function InviteLanding({ token, state }: { token: string; state: InviteViewState }) {
  switch (state.kind) {
    case "error":
      return <Notice title="Não foi possível abrir o convite" text={state.message} />;
    case "invalid":
      return (
        <div className="space-y-4">
          <Notice title="Convite inválido ou expirado" text="Este link não pode mais ser usado. Peça um novo convite a um proprietário da organização." />
          <Link href="/login" className={buttonVariants({ variant: "outline", className: "w-full" })}>
            Ir para o login
          </Link>
        </div>
      );
    case "wrong-account":
      return (
        <div className="space-y-4">
          <Notice
            title="Este convite é para outro e-mail"
            text={`O convite para ${state.orgName} foi enviado para ${maskEmail(state.inviteEmail)}, mas você está conectado como ${state.currentEmail}. Saia e entre com a conta do convite.`}
          />
          <div className="flex justify-center">
            <LogoutButton />
          </div>
        </div>
      );
    case "accept":
      return <AcceptPanel token={token} orgName={state.orgName} orgRole={state.orgRole} />;
    case "login":
      return (
        <div className="space-y-4">
          <Summary orgName={state.orgName} orgRole={state.orgRole} email={state.email} />
          <p className="text-sm text-muted-foreground">Este e-mail já possui cadastro. Entre na sua conta para aceitar o convite.</p>
          <Link href={`/login?next=${encodeURIComponent(`/convite/${token}`)}`} className={buttonVariants({ size: "lg", className: "w-full" })}>
            Entrar e aceitar o convite
          </Link>
        </div>
      );
    case "signup":
      return (
        <div className="space-y-4">
          <Summary orgName={state.orgName} orgRole={state.orgRole} email={state.email} />
          <InviteSignupForm token={token} email={state.email} />
          <p className="text-center text-xs text-muted-foreground">
            Já tem conta?{" "}
            <Link href={`/login?next=${encodeURIComponent(`/convite/${token}`)}`} className="font-medium text-primary underline-offset-2 hover:underline">
              Entrar
            </Link>
          </p>
        </div>
      );
  }
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function Summary({ orgName, orgRole, email }: { orgName: string; orgRole: OrgRoleName; email: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-border bg-muted/40 p-4">
      <MailCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
      <div className="min-w-0 space-y-0.5 text-sm">
        <p>
          Você foi convidado para <strong className="break-words">{orgName}</strong> como {roleLabel(orgRole).toLowerCase()}.
        </p>
        <p className="break-all text-xs text-muted-foreground">Convite para {email}</p>
      </div>
    </div>
  );
}

function AcceptPanel({ token, orgName, orgRole }: { token: string; orgName: string; orgRole: OrgRoleName }) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string>();
  const onAccept = () =>
    startTransition(async () => {
      setError(undefined);
      const res = await acceptInvite({ token });
      if (res.ok) {
        toast.success(`Você entrou em ${orgName}.`);
        window.location.assign(res.data.redirectTo);
        return;
      }
      const msg = getFormError(res.errors);
      setError(msg);
      toast.error(msg);
    });
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
        Você foi convidado para <strong className="break-words">{orgName}</strong> como {roleLabel(orgRole).toLowerCase()}.
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button size="lg" className="w-full" onClick={onAccept} disabled={pending} aria-busy={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {pending ? "Entrando..." : "Aceitar convite"}
      </Button>
    </div>
  );
}

const FIELDS = ["name", "password", "confirmPassword"] as const;

export function InviteSignupForm({ token, email }: { token: string; email: string }) {
  const [pending, startTransition] = React.useTransition();
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    control,
    formState: { errors },
  } = useForm<InviteSignupFormInput>({ resolver: zodResolver(inviteSignupFormSchema), defaultValues: { name: "", password: "", confirmPassword: "" } });
  const [pw, nm] = useWatch({ control, name: ["password", "name"] });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const res = await signUpAndJoin({ name: values.name, password: values.password, confirmPassword: values.confirmPassword, token });
      if (res.ok) {
        window.location.assign(res.data.redirectTo);
        return;
      }
      toast.error(applyServerErrors(res.errors, setError, setFocus, FIELDS));
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Criar conta para aceitar o convite">
      {errors.root?.message && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <Field id="invite-email" label="E-mail" hint="Definido pelo convite.">
        {(a) => <Input {...a} type="email" value={email} readOnly autoComplete="email" />}
      </Field>
      <Field id="invite-name" label="Nome" error={errors.name?.message}>
        {(a) => <Input {...a} {...register("name")} type="text" autoComplete="name" autoFocus required />}
      </Field>
      <Field id="invite-password" label="Senha" hint="Mínimo de 6 caracteres." error={errors.password?.message}>
        {(a) => <PasswordInput {...a} {...register("password")} required />}
      </Field>
      <PasswordStrength password={pw ?? ""} personal={[nm ?? "", email]} />
      <Field id="invite-confirm-password" label="Confirmar senha" error={errors.confirmPassword?.message}>
        {(a) => <PasswordInput {...a} {...register("confirmPassword")} required />}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {pending ? "Criando conta..." : "Criar conta e entrar"}
      </Button>
    </form>
  );
}
