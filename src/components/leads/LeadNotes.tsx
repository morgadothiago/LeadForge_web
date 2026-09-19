"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { Field } from "@/components/campaigns/Field";
import { Button } from "@/components/ui/button";
import { addNote, deleteNote } from "@/lib/actions/lead";
import { formatDateTime } from "./lead-format";

export function LeadNotes({ leadId, notes }: { leadId: string; notes: { id: string; body: string; createdAt: Date }[] }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | undefined>();
  const [toDelete, setToDelete] = React.useState<string | null>(null);
  const [delError, setDelError] = React.useState<string | undefined>();
  const [pending, startTransition] = React.useTransition();

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await addNote({ leadId, body });
      if (r.ok) {
        setBody("");
        setError(undefined);
        toast.success("Anotação adicionada.");
        router.refresh();
      } else setError(r.errors.body?.[0] ?? r.errors._form?.[0] ?? "Não foi possível salvar a anotação.");
    });
  }
  function onDelete() {
    if (!toDelete) return;
    startTransition(async () => {
      const r = await deleteNote({ noteId: toDelete });
      if (r.ok) {
        setToDelete(null);
        toast.success("Anotação excluída.");
        router.refresh();
      } else setDelError(r.errors._form?.[0] ?? "Não foi possível excluir a anotação.");
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onAdd} className="space-y-2" noValidate>
        <Field id={`note-${leadId}`} label="Nova anotação" error={error}>
          {(a) => (
            <textarea
              {...a}
              rows={3}
              maxLength={5000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 aria-invalid:border-destructive"
            />
          )}
        </Field>
        <Button type="submit" disabled={pending || !body.trim()}>
          Adicionar anotação
        </Button>
      </form>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma anotação.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start gap-2 rounded-md border border-border p-3">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words text-sm">{n.body}</p>
                <time dateTime={n.createdAt.toISOString()} className="mt-1 block text-xs text-muted-foreground">
                  {formatDateTime(n.createdAt)}
                </time>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Excluir anotação"
                onClick={() => {
                  setDelError(undefined);
                  setToDelete(n.id);
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Excluir anotação?"
        description="Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        destructive
        pending={pending}
        error={delError}
        onConfirm={onDelete}
      />
    </div>
  );
}
