"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { addTag, removeTag } from "@/lib/actions/lead";
import { MAX_TAGS, MAX_TAG_LENGTH } from "@/lib/schemas/lead";

export function LeadTags({ leadId, tags }: { leadId: string; tags: string[] }) {
  const router = useRouter();
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | undefined>();
  const [pending, startTransition] = React.useTransition();

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    startTransition(async () => {
      const r = await addTag({ leadId, tag: value });
      if (r.ok) {
        setValue("");
        setError(undefined);
        router.refresh();
      } else setError(r.errors.tag?.[0] ?? r.errors._form?.[0] ?? "Não foi possível adicionar a tag.");
    });
  }
  function onRemove(tag: string) {
    startTransition(async () => {
      const r = await removeTag({ leadId, tag });
      if (r.ok) router.refresh();
      else toast.error(r.errors._form?.[0] ?? "Não foi possível remover a tag.");
    });
  }

  return (
    <div className="space-y-3">
      {tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma tag.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags do lead">
          {tags.map((t) => (
            <li key={t} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-xs font-medium">
              {t}
              <button
                type="button"
                onClick={() => onRemove(t)}
                disabled={pending}
                aria-label={`Remover tag ${t}`}
                className="flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onAdd} className="flex items-start gap-2" noValidate>
        <div className="flex-1">
          <Field id={`tag-${leadId}`} label="Nova tag" error={error} hint={`Até ${MAX_TAG_LENGTH} caracteres · ${tags.length}/${MAX_TAGS} tags`}>
            {(a) => <Input {...a} value={value} onChange={(e) => setValue(e.target.value)} maxLength={MAX_TAG_LENGTH} />}
          </Field>
        </div>
        <Button type="submit" variant="outline" disabled={pending || !value.trim()} className="mt-[1.65rem]">
          Adicionar
        </Button>
      </form>
    </div>
  );
}
