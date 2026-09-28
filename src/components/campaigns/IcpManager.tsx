"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldPath } from "react-hook-form";
import { z } from "zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createIcp, deleteIcp, updateIcp } from "@/lib/actions/icp";
import { icpInputSchema, icpUpdateSchema } from "@/lib/schemas/icp";
import type { IcpSummary } from "@/lib/queries/campaigns";
import { ConfirmDialog } from "./ConfirmDialog";
import { IcpFields } from "./IcpFields";
import { EMPTY_ICP, getFormError, icpToValues, toIcpInput, type IcpValues } from "./form-utils";

type IcpSubmit = z.output<typeof icpInputSchema> | z.output<typeof icpUpdateSchema>;

function IcpFormDialog({ icp, open, onOpenChange }: { icp: IcpSummary | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  // SPEC-043: mesmo schema da action (icpInputSchema/icpUpdateSchema); o preprocess só adapta as
  // listas de texto com vírgula da UI para os arrays que o servidor espera — nenhuma regra duplicada.
  const resolver = React.useMemo(
    () =>
      icp
        ? zodResolver(z.preprocess((v: IcpValues) => ({ ...toIcpInput(v), id: icp.id }), icpUpdateSchema))
        : zodResolver(z.preprocess((v: IcpValues) => toIcpInput(v), icpInputSchema)),
    [icp],
  );
  const { register, handleSubmit, setError, formState } = useForm<IcpValues, unknown, IcpSubmit>({
    resolver,
    defaultValues: icp ? icpToValues(icp) : EMPTY_ICP,
  });
  const { errors } = formState;

  const onSubmit = handleSubmit((values) => {
    start(async () => {
      const r = icp ? await updateIcp(values) : await createIcp(values);
      if (r.ok) {
        toast.success(icp ? "ICP atualizado." : "ICP criado.");
        onOpenChange(false);
        router.refresh();
        return;
      }
      for (const [key, msgs] of Object.entries(r.errors)) {
        if (key === "_form") continue;
        setError(key as FieldPath<IcpValues>, { type: "server", message: msgs.join(" ") });
      }
      if (r.errors._form) setError("root", { type: "server", message: r.errors._form.join(" ") });
      toast.error(getFormError(r.errors));
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{icp ? "Editar ICP" : "Novo ICP"}</DialogTitle>
          <DialogDescription>Descreva o perfil de cliente ideal usado na busca de leads.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {errors.root?.message && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errors.root.message}
            </p>
          )}
          <IcpFields
            idPrefix="icp-dlg"
            prefix=""
            register={(n) => register(n as FieldPath<IcpValues>)}
            errors={errors}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IcpManager({ icps }: { icps: IcpSummary[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<IcpSummary | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deleting, setDeleting] = React.useState<IcpSummary | null>(null);
  const [error, setError] = React.useState<string>();
  const [pending, start] = React.useTransition();

  function confirmDelete() {
    if (!deleting) return;
    start(async () => {
      const r = await deleteIcp(deleting.id);
      if (r.ok) {
        toast.success("ICP excluído.");
        setDeleting(null);
        router.refresh();
      } else setError(Object.values(r.errors).flat()[0] ?? "Não foi possível excluir.");
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus /> Novo ICP
        </Button>
      </div>
      {icps.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-heading text-lg font-semibold">Nenhum ICP cadastrado</p>
          <p className="mt-1 text-sm text-muted-foreground">Crie um perfil de cliente ideal para reutilizar em várias campanhas.</p>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {icps.map((i) => (
            <li key={i.id}>
              <Card className="flex h-full flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate font-heading text-base font-semibold">{i.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {i.niche}
                      {i.location ? ` · ${i.location}` : ""}
                      {i.companySize ? ` · ${i.companySize}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0">
                    <Button variant="ghost" size="icon" aria-label={`Editar ${i.name}`} onClick={() => setEditing(i)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Excluir ${i.name}`} onClick={() => { setError(undefined); setDeleting(i); }}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[...i.signals, ...i.keywords].slice(0, 6).map((t) => (
                    <Badge key={t} variant="muted">
                      {t}
                    </Badge>
                  ))}
                </div>
                <p className="mt-auto text-xs text-muted-foreground">
                  Usado em {i.campaignCount} campanha{i.campaignCount === 1 ? "" : "s"}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {creating && <IcpFormDialog icp={null} open onOpenChange={setCreating} />}
      {editing && <IcpFormDialog key={editing.id} icp={editing} open onOpenChange={(o) => !o && setEditing(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Excluir ICP?"
        description={
          deleting && deleting.campaignCount > 0
            ? `"${deleting.name}" está em uso por ${deleting.campaignCount} campanha(s) e não pode ser excluído.`
            : `"${deleting?.name}" será excluído permanentemente.`
        }
        confirmLabel="Excluir"
        destructive
        pending={pending}
        error={error}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
