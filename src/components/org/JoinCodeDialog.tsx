"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { generateJoinCode } from "@/lib/actions/org";
import { joinCodeFormSchema, type JoinCodeFormInput, type JoinCodeFormOutput } from "@/lib/schemas/org";
import { applyServerErrors } from "./org-format";

const FIELDS = ["expiresInDays", "maxUses"] as const;

/** SPEC-049b — gera (ou rotaciona) o código de entrada. Padrão do backend: 7 dias / 10 usos; máx. 30 dias / 100 usos. */
export function JoinCodeDialog({ rotate }: { rotate: boolean }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant={rotate ? "outline" : "default"} size={rotate ? "sm" : "default"} onClick={() => setOpen(true)}>
        <KeyRound aria-hidden="true" /> {rotate ? "Gerar novo código" : "Gerar código de entrada"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{rotate ? "Gerar novo código" : "Gerar código de entrada"}</DialogTitle>
            <DialogDescription>
              {rotate
                ? "O código atual deixa de funcionar imediatamente. Quem usar o novo entra como membro, sem aprovação."
                : "Quem tiver o código pode criar conta (ou entrar) como membro, sem aprovação. Compartilhe só com quem confia."}
            </DialogDescription>
          </DialogHeader>
          <CodeForm onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function CodeForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<JoinCodeFormInput, unknown, JoinCodeFormOutput>({ resolver: zodResolver(joinCodeFormSchema), defaultValues: { expiresInDays: 7, maxUses: 10 } });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const res = await generateJoinCode(values);
      if (res.ok) {
        toast.success("Código de entrada gerado.");
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="code-days" label="Validade (dias)" hint="De 1 a 30." error={errors.expiresInDays?.message}>
          {(a) => <Input {...a} {...register("expiresInDays")} type="number" inputMode="numeric" min={1} max={30} step={1} />}
        </Field>
        <Field id="code-uses" label="Limite de usos" hint="De 1 a 100." error={errors.maxUses?.message}>
          {(a) => <Input {...a} {...register("maxUses")} type="number" inputMode="numeric" min={1} max={100} step={1} />}
        </Field>
      </div>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Gerando..." : "Gerar código"}
        </Button>
      </DialogFooter>
    </form>
  );
}
