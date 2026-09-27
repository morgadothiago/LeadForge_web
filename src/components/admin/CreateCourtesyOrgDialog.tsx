"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Mail, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { fieldError, getFormError } from "@/components/campaigns/form-utils";
import { createCourtesyOrganization } from "@/lib/actions/admin/organizations";
import type { FieldErrors } from "@/lib/actions/result";

/**
 * SPEC-040 — formulário de criação manual de conta de cortesia (`platform_admin`). Mesmo padrão de
 * `SuppressionAddDialog`/`WhatsAppInstanceFormDialog`: dialog na própria página de listagem (não uma
 * sub-rota nova), `useState` manual + `fieldError`/`getFormError` (SPEC-042 ainda DRAFT — não adianta a
 * migração para react-hook-form). Não há campo de senha: a action cria a conta sem `passwordHash` e
 * envia por e-mail um link para o novo usuário definir a própria senha (reaproveita SPEC-038) — por
 * isso o aviso abaixo dos campos, deixando isso explícito para o admin antes de confirmar.
 */
export function CreateCourtesyOrgDialog() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Nova conta de cortesia
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Criar conta de cortesia</DialogTitle>
            <DialogDescription>Cria uma organização com acesso completo, sem cobrança — para parceiros, demos internas ou contas de teste.</DialogDescription>
          </DialogHeader>
          <CreateForm onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const uid = React.useId();
  const [name, setName] = React.useState("");
  const [ownerName, setOwnerName] = React.useState("");
  const [ownerEmail, setOwnerEmail] = React.useState("");
  const [errors, setErrors] = React.useState<FieldErrors>();
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors(undefined);
    startTransition(async () => {
      const r = await createCourtesyOrganization({ name: name.trim(), ownerEmail: ownerEmail.trim(), ownerName: ownerName.trim() });
      if (r.ok) {
        toast.success(`Conta de cortesia criada. ${ownerEmail.trim()} vai receber um e-mail para definir a senha.`);
        onDone();
        router.refresh();
      } else {
        setErrors(r.errors);
        toast.error(getFormError(r.errors));
      }
    });
  }

  const formError = fieldError(errors, "_form");

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      {formError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}
      <Field id={`${uid}-name`} label="Nome da organização" required error={fieldError(errors, "name")}>
        {(a) => <Input {...a} value={name} maxLength={120} autoComplete="off" onChange={(e) => setName(e.target.value)} placeholder="Ex.: Empresa Parceira Ltda." />}
      </Field>
      <Field id={`${uid}-owner-name`} label="Nome do dono da conta" required error={fieldError(errors, "ownerName")}>
        {(a) => <Input {...a} value={ownerName} maxLength={120} autoComplete="off" onChange={(e) => setOwnerName(e.target.value)} placeholder="Ex.: Maria Souza" />}
      </Field>
      <Field id={`${uid}-owner-email`} label="E-mail do dono da conta" required error={fieldError(errors, "ownerEmail")} hint="Precisa ser único — ainda não pode ter conta cadastrada.">
        {(a) => <Input {...a} type="email" inputMode="email" autoComplete="off" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="nome@empresa.com" />}
      </Field>
      <div role="note" className="flex gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          Nenhuma senha é definida aqui. Ao criar a conta, o dono recebe um e-mail com um link para escolher a própria senha (mesmo fluxo de &ldquo;esqueci minha senha&rdquo;).
        </p>
      </div>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Criando…" : "Criar conta"}
        </Button>
      </DialogFooter>
    </form>
  );
}
