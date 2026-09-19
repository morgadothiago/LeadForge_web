"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { deleteSequence, duplicateSequence } from "@/lib/actions/sequence";

export function SequenceActions({ id, name, afterDeleteHref }: { id: string; name: string; afterDeleteHref?: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string>();

  function duplicate() {
    start(async () => {
      const r = await duplicateSequence(id);
      if (r.ok) {
        toast.success("Sequência duplicada.");
        router.push(`/sequences/${r.data.id}`);
      } else toast.error(Object.values(r.errors).flat()[0] ?? "Não foi possível duplicar.");
    });
  }

  function remove() {
    start(async () => {
      const r = await deleteSequence(id);
      if (r.ok) {
        toast.success("Sequência excluída.");
        setOpen(false);
        if (afterDeleteHref) router.push(afterDeleteHref);
        router.refresh();
      } else setError(Object.values(r.errors).flat()[0] ?? "Não foi possível excluir.");
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={duplicate} disabled={pending} aria-label={`Duplicar sequência ${name}`}>
        <Copy /> Duplicar
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive"
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
        disabled={pending}
        aria-label={`Excluir sequência ${name}`}
      >
        <Trash2 /> Excluir
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Excluir sequência?"
        description={`"${name}" e seus passos serão excluídos permanentemente. Os templates são mantidos.`}
        confirmLabel="Excluir"
        destructive
        pending={pending}
        error={error}
        onConfirm={remove}
      />
    </>
  );
}
