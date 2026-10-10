"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { OptionSelect } from "@/components/campaigns/OptionSelect";
import { inviteMember } from "@/lib/actions/org";
import { inviteFormSchema, type InviteMemberInput } from "@/lib/schemas/org";
import { applyServerErrors, ROLE_LABEL } from "./org-format";

const FIELDS = ["email", "orgRole"] as const;
const ROLE_OPTIONS = [
  { value: "member", label: `${ROLE_LABEL.member} — vê a equipe e pode sair` },
  { value: "owner", label: `${ROLE_LABEL.owner} — convida, remove e gere a assinatura` },
];

/** SPEC-049b — convite nominal por e-mail (owner). O servidor responde igual para qualquer e-mail (anti-enumeração): a UI só informa envio. */
export function InviteMemberDialog({ open: controlledOpen, onOpenChange, triggerLabel = "Convidar por e-mail", triggerVariant = "default", triggerSize = "default" }: { open?: boolean; onOpenChange?: (open: boolean) => void; triggerLabel?: string; triggerVariant?: "default" | "outline"; triggerSize?: "default" | "sm" }) {
  const [innerOpen, setInnerOpen] = React.useState(false);
  // D-049-17: modo controlado (sem botão próprio) usado pelo seletor da sidebar; sem `open`, comporta-se como antes.
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : innerOpen;
  const setOpen = controlled ? (onOpenChange ?? (() => {})) : setInnerOpen;
  return (
    <>
      {!controlled && (
        <Button variant={triggerVariant} size={triggerSize} onClick={() => setOpen(true)}>
          <UserPlus aria-hidden="true" /> {triggerLabel}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Convidar para a organização</DialogTitle>
            <DialogDescription>Enviamos um link de convite válido por 7 dias. Só o e-mail convidado consegue aceitar.</DialogDescription>
          </DialogHeader>
          <InviteForm onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const {
    register,
    control,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<InviteMemberInput>({ resolver: zodResolver(inviteFormSchema), defaultValues: { email: "", orgRole: "member" } });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const res = await inviteMember(values);
      if (res.ok) {
        if (res.data.emailSent) toast.success(`Convite enviado para ${values.email}.`);
        else toast.warning("Convite criado, mas não foi possível enviar o e-mail agora. Revogue e convide novamente em instantes.");
        onDone();
        router.refresh();
        return;
      }
      toast.error(applyServerErrors(res.errors, setError, setFocus, FIELDS));
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {errors.root?.message && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <Field id="invite-member-email" label="E-mail" required error={errors.email?.message}>
        {(a) => <Input {...a} {...register("email")} type="email" inputMode="email" autoComplete="off" autoFocus placeholder="nome@empresa.com" />}
      </Field>
      <Field id="invite-member-role" label="Papel" error={errors.orgRole?.message}>
        {(a) => (
          <Controller
            control={control}
            name="orgRole"
            render={({ field }) => (
              <OptionSelect id={a.id} value={field.value ?? "member"} onChange={(v) => field.onChange(v ?? "member")} placeholder="Selecione" options={ROLE_OPTIONS} invalid={a["aria-invalid"]} describedBy={a["aria-describedby"]} />
            )}
          />
        )}
      </Field>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Enviando..." : "Enviar convite"}
        </Button>
      </DialogFooter>
    </form>
  );
}
