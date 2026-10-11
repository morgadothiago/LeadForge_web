"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MailCheck, ShieldAlert, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/campaigns/Field";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { cancelAccountDeletion, requestAccountDeletion } from "@/lib/actions/account-deletion";
import { requestAccountDeletionSchema, type RequestAccountDeletionInput } from "@/lib/schemas/account-deletion";
import { ANONYMIZED_ITEMS, DELETED_ITEMS, RETAINED_ITEMS } from "@/lib/account-deletion/retention";
import { blockerTitle, deletionErrorMessage, errorCode, formatDeletionDate, formatDeletionDateTime } from "./deletion-format";

export interface DeletionPanelState {
  status: "none" | "awaiting_confirmation" | "scheduled";
  confirmationExpiresAt: Date | string | null;
  scheduledFor: Date | string | null;
  windowDays: number;
  blockers: { code: string; message: string; orgName?: string }[];
  canRequest: boolean;
}

/**
 * SPEC-054b — secao "Excluir minha conta" (Configuracoes > Conta). Estados: none (explicacao + bloqueios + senha),
 * awaiting_confirmation ("confira seu e-mail"; pode reenviar/cancelar) e scheduled ("exclusao agendada para DD/MM" +
 * "Cancelar exclusao"). A retencao exibida vem de `retention.ts` (mesma fonte do e-mail "conta excluida" e da purga).
 */
export function DeleteAccountPanel({ state }: { state: DeletionPanelState }) {
  return (
    <section aria-labelledby="delete-account-title" className="space-y-4">
      <div>
        <h2 id="delete-account-title" className="font-heading text-lg font-semibold">
          Excluir minha conta
        </h2>
        <p className="text-sm text-muted-foreground">Peça a exclusão dos seus dados pessoais (direito de eliminação da LGPD).</p>
      </div>
      <Card className="space-y-5 border-destructive/30 p-4 sm:p-6">
        {state.status === "scheduled" ? <ScheduledView state={state} /> : <RequestView state={state} />}
      </Card>
    </section>
  );
}

function ScheduledView({ state }: { state: DeletionPanelState }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string>();
  const when = state.scheduledFor ? formatDeletionDate(state.scheduledFor) : "";

  function cancel() {
    setError(undefined);
    startTransition(async () => {
      const r = await cancelAccountDeletion();
      if (r.ok) {
        toast.success("Exclusão cancelada. Sua conta continua ativa.");
        router.refresh();
        return;
      }
      setError(
        errorCode(r.errors) === "not_pending"
          ? "Não é possível cancelar por aqui. Use o link \"cancelar\" do e-mail que enviamos ou entre pela tela de login e escolha cancelar a exclusão."
          : deletionErrorMessage(r.errors),
      );
    });
  }

  return (
    <div className="space-y-4">
      <div role="status" className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="space-y-1">
          <p className="font-medium">Exclusão agendada para {when}</p>
          <p className="text-muted-foreground">
            Até lá sua conta fica bloqueada e você ainda pode mudar de ideia. Depois dessa data a exclusão é definitiva.
          </p>
        </div>
      </div>
      <Button variant="outline" onClick={cancel} disabled={pending} aria-busy={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        Cancelar exclusão
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function RequestView({ state }: { state: DeletionPanelState }) {
  const awaiting = state.status === "awaiting_confirmation";
  return (
    <>
      {awaiting && <AwaitingNotice expiresAt={state.confirmationExpiresAt} />}
      <Explanation windowDays={state.windowDays} />
      {state.blockers.length > 0 ? <Blockers blockers={state.blockers} /> : <PasswordForm awaiting={awaiting} />}
    </>
  );
}

function AwaitingNotice({ expiresAt }: { expiresAt: Date | string | null }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string>();
  function cancel() {
    setError(undefined);
    startTransition(async () => {
      const r = await cancelAccountDeletion();
      if (r.ok || errorCode(r.errors) === "not_pending") {
        if (r.ok) toast.success("Pedido de exclusão cancelado.");
        router.refresh();
        return;
      }
      setError(deletionErrorMessage(r.errors));
    });
  }
  return (
    <div role="status" className="space-y-3 rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm">
      <div className="flex gap-3">
        <MailCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="space-y-1">
          <p className="font-medium">Confira seu e-mail</p>
          <p className="text-muted-foreground">
            Enviamos um link para confirmar a exclusão{expiresAt ? <> (vale até {formatDeletionDateTime(expiresAt)})</> : null}. Nada será excluído até você abrir o link. Para reenviar, informe sua senha abaixo.
          </p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={cancel} disabled={pending} aria-busy={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        Cancelar pedido
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function ItemList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function Explanation({ windowDays }: { windowDays: number }) {
  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Você informa sua senha e enviamos um e-mail de confirmação.</li>
        <li>
          Ao abrir o link, sua conta é bloqueada e a exclusão fica agendada para daqui a <strong className="text-foreground">{windowDays} dias</strong>. Nesse prazo você pode se arrepender e cancelar.
        </li>
        <li>Passado o prazo, a exclusão é definitiva e avisamos por e-mail.</li>
      </ol>
      <div className="grid gap-4 md:grid-cols-3">
        <ItemList title="Será apagado" items={DELETED_ITEMS} />
        <ItemList title="Será anonimizado" items={ANONYMIZED_ITEMS} />
        <ItemList title="Fica retido após a exclusão" items={RETAINED_ITEMS} />
      </div>
    </div>
  );
}

function Blockers({ blockers }: { blockers: DeletionPanelState["blockers"] }) {
  return (
    <div role="alert" className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <ShieldAlert aria-hidden="true" className="size-5 shrink-0 text-warning" /> Ainda não é possível excluir sua conta
      </p>
      <ul className="space-y-2">
        {blockers.map((b, i) => (
          <li key={`${b.code}-${i}`}>
            <p className="font-medium">{blockerTitle(b.code)}</p>
            <p className="text-muted-foreground">{b.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PasswordForm({ awaiting }: { awaiting: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    reset,
    formState: { errors },
  } = useForm<RequestAccountDeletionInput>({ resolver: zodResolver(requestAccountDeletionSchema), defaultValues: { password: "" } });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const res = await requestAccountDeletion(values);
      if (res.ok) {
        reset({ password: "" });
        if (res.data.emailSent) toast.success("Enviamos o e-mail de confirmação. Confira sua caixa de entrada.");
        else toast.warning("Pedido registrado, mas não conseguimos enviar o e-mail agora. Tente reenviar em instantes.");
        router.refresh();
        return;
      }
      const code = errorCode(res.errors);
      if (code === "already_scheduled") {
        router.refresh();
        return;
      }
      if (res.errors.password) {
        setError("password", { type: "server", message: res.errors.password.join(" ") });
        setFocus("password");
        return;
      }
      // blocked / rate_limited / demais: mensagem geral (sem codigos tecnicos).
      setError("root", { type: "server", message: deletionErrorMessage(res.errors) });
      if (code === "blocked") router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-sm space-y-4">
      {errors.root?.message && (
        <p role="alert" aria-live="assertive" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <Field id="delete-account-password" label="Confirme sua senha" error={errors.password?.message} hint="Por segurança, pedimos a senha para iniciar a exclusão.">
        {(a) => <PasswordInput {...a} {...register("password")} autoComplete="current-password" required />}
      </Field>
      <Button type="submit" variant="destructive" disabled={pending} aria-busy={pending} className="w-full sm:w-auto">
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {pending ? "Enviando..." : awaiting ? "Reenviar e-mail de confirmação" : "Excluir minha conta"}
      </Button>
    </form>
  );
}
