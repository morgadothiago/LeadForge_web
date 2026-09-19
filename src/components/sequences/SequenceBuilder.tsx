"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Plus } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { fieldError } from "@/components/campaigns/form-utils";
import { createSequence, renameSequence, saveSequenceSteps } from "@/lib/actions/sequence";
import { previewTemplate, type TemplatePreview } from "@/lib/actions/template";
import type { ActionResult, FieldErrors } from "@/lib/actions/result";
import { StepRow } from "./StepRow";
import type { StepDraft, TemplateOption } from "./types";

interface Props {
  mode: "create" | "edit";
  templates: TemplateOption[];
  sequence?: { id: string; name: string; steps: StepDraft[] };
  /** campanhas ativas usando a sequência (aviso ao editar) */
  activeCampaigns?: number;
}

type PreviewState = TemplatePreview | { error: string } | "loading";

/** Garante dias não decrescentes após reordenar: cada dia >= anterior. */
function fixDays(steps: StepDraft[]): { steps: StepDraft[]; adjusted: boolean } {
  let adjusted = false;
  const out = [...steps];
  for (let i = 1; i < out.length; i++) {
    if (!Number.isNaN(out[i].day) && !Number.isNaN(out[i - 1].day) && out[i].day < out[i - 1].day) {
      out[i] = { ...out[i], day: out[i - 1].day };
      adjusted = true;
    }
  }
  return { steps: out, adjusted };
}

export function SequenceBuilder({ mode, templates, sequence, activeCampaigns = 0 }: Props) {
  const router = useRouter();
  const counter = React.useRef(0);
  const [name, setName] = React.useState(sequence?.name ?? "");
  const [steps, setSteps] = React.useState<StepDraft[]>(sequence?.steps ?? []);
  const [errors, setErrors] = React.useState<FieldErrors | undefined>();
  const [live, setLive] = React.useState("");
  const [previews, setPreviews] = React.useState<Record<string, PreviewState>>({});
  const [pending, startTransition] = React.useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byId = React.useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);
  const lockedCampaignId = steps.map((s) => (s.templateId ? byId.get(s.templateId)?.campaignId : undefined)).find(Boolean);
  const lockedCampaign = lockedCampaignId ? templates.find((t) => t.campaignId === lockedCampaignId)?.campaignName : undefined;

  const templatesFor = (s: StepDraft) =>
    templates.filter((t) => t.channel === s.channel && (!lockedCampaignId || t.campaignId === lockedCampaignId));

  // previews por template (server action previewTemplate, lead de exemplo), com cache por id
  const usedIds = [...new Set(steps.map((s) => s.templateId).filter((v): v is string => Boolean(v)))].join(",");
  const requested = React.useRef(new Set<string>());
  React.useEffect(() => {
    for (const id of usedIds ? usedIds.split(",") : []) {
      const t = byId.get(id);
      if (!t || requested.current.has(id)) continue;
      requested.current.add(id);
      void previewTemplate({ campaignId: t.campaignId, channel: t.channel, name: t.name, subject: t.subject, body: t.body }).then((r) => {
        setPreviews((q) => ({
          ...q,
          [id]: r.ok ? r.data : { error: Object.values(r.errors).flat()[0] ?? "Não foi possível gerar a pré-visualização." },
        }));
      });
    }
  }, [usedIds, byId]);

  const announce = (m: string) => setLive(m);

  function applyOrder(next: StepDraft[], movedIndex: number) {
    const { steps: fixed, adjusted } = fixDays(next);
    setSteps(fixed);
    announce(
      `Passo movido para a posição ${movedIndex + 1} de ${fixed.length}.` +
        (adjusted ? " Alguns dias foram ajustados para manter a ordem não decrescente." : ""),
    );
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= steps.length) return;
    applyOrder(arrayMove(steps, from, to), to);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = steps.findIndex((s) => s.key === active.id);
    const to = steps.findIndex((s) => s.key === over.id);
    if (from >= 0 && to >= 0) move(from, to);
  }

  const posOf = (id: string | number) => steps.findIndex((s) => s.key === id) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Passo ${posOf(active.id)} pego. Use as setas para mover.`,
    onDragOver: ({ active, over }) => (over ? `Passo ${posOf(active.id)} está sobre a posição ${posOf(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `Passo ${posOf(active.id)} solto na posição ${posOf(over.id)}.` : `Passo ${posOf(active.id)} solto sem mudança.`),
    onDragCancel: ({ active }) => `Movimento cancelado. Passo ${posOf(active.id)} voltou à posição original.`,
  };

  function addStep() {
    const last = steps.at(-1);
    counter.current += 1;
    setSteps([
      ...steps,
      { key: `new-${counter.current}`, day: last && !Number.isNaN(last.day) ? last.day : 0, channel: last?.channel ?? "email", templateId: null },
    ]);
    announce(`Passo ${steps.length + 1} adicionado.`);
  }

  const update = (key: string, patch: Partial<StepDraft>) =>
    setSteps((cur) => cur.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors(undefined);
    const missing: FieldErrors = {};
    steps.forEach((s, i) => {
      if (!s.templateId) missing[`steps.${i}.templateId`] = ["Selecione um template."];
      if (Number.isNaN(s.day)) missing[`steps.${i}.day`] = ["Dia é obrigatório."];
    });
    if (Object.keys(missing).length) {
      setErrors(missing);
      toast.error("Corrija os campos destacados.");
      return;
    }
    const payload = steps.map((s) => ({ ...(s.id ? { id: s.id } : {}), day: s.day, channel: s.channel, templateId: s.templateId }));
    startTransition(async () => {
      let r: ActionResult<{ id: string; activeCampaigns: number }>;
      if (mode === "create") {
        r = await createSequence({ name, steps: payload.map(({ day, channel, templateId }) => ({ day, channel, templateId })) });
      } else if (sequence) {
        if (name.trim() !== sequence.name) {
          const rn = await renameSequence({ id: sequence.id, name });
          if (!rn.ok) {
            setErrors(rn.errors);
            return;
          }
        }
        r = await saveSequenceSteps({ sequenceId: sequence.id, steps: payload });
      } else return;
      if (!r.ok) {
        setErrors(r.errors);
        toast.error("Não foi possível salvar a sequência.");
        return;
      }
      if (mode === "create") {
        toast.success("Sequência criada.");
        router.push(`/sequences/${r.data.id}`);
      } else {
        toast.success(
          r.data.activeCampaigns > 0
            ? `Sequência salva. ${r.data.activeCampaigns} campanha(s) ativa(s) usam esta sequência.`
            : "Sequência salva.",
        );
        router.refresh();
      }
    });
  }

  const stepErrors = (i: number) => ({
    day: fieldError(errors, `steps.${i}.day`),
    templateId: fieldError(errors, `steps.${i}.templateId`),
  });
  const listError = [errors?.["steps"], errors?.["_form"]].flatMap((m) => m ?? []).join(" ") || undefined;

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-6" noValidate>
      {mode === "edit" && activeCampaigns > 0 && (
        <p role="status" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
          {activeCampaigns} campanha{activeCampaigns === 1 ? "" : "s"} ativa{activeCampaigns === 1 ? "" : "s"} usa{activeCampaigns === 1 ? "" : "m"} esta
          sequência. Alterações afetam os próximos toques.
        </p>
      )}
      {listError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {listError}
        </p>
      )}

      <Card className="p-5">
        <Field id="seq-name" label="Nome da sequência" required error={fieldError(errors, "name")}>
          {(a) => <Input {...a} value={name} maxLength={120} disabled={pending} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </Card>

      <section aria-labelledby="steps-title" className="space-y-3">
        <div>
          <h2 id="steps-title" className="font-heading text-base font-semibold">
            Passos
          </h2>
          <p className="text-sm text-muted-foreground">
            Os dias não podem diminuir de um passo para o próximo. Arraste, ou use os botões de subir e descer. Todos os templates da sequência
            precisam ser da mesma campanha
            {lockedCampaign ? (
              <>
                : a lista mostra apenas templates de <strong>{lockedCampaign}</strong>.
              </>
            ) : (
              <>: ao escolher o primeiro template, os demais ficam limitados à campanha dele.</>
            )}{" "}
            Gerencie-os em{" "}
            <Link href="/sequences/templates" className="underline">
              Templates
            </Link>
            .
          </p>
        </div>

        {steps.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Nenhum passo ainda. Adicione o primeiro contato da cadência.</Card>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            accessibility={{
              announcements,
              screenReaderInstructions: {
                draggable: "Para reordenar, pressione espaço ou Enter, use as setas para cima e para baixo e solte com espaço. Esc cancela.",
              },
            }}
          >
            <SortableContext items={steps.map((s) => s.key)} strategy={verticalListSortingStrategy}>
              <ol className="space-y-3">
                {steps.map((s, i) => (
                  <StepRow
                    key={s.key}
                    step={s}
                    index={i}
                    total={steps.length}
                    templates={templatesFor(s)}
                    preview={s.templateId ? previews[s.templateId] : undefined}
                    errors={stepErrors(i)}
                    disabled={pending}
                    onChange={(p) => update(s.key, p)}
                    onMove={(d) => move(i, i + d)}
                    onRemove={() => {
                      setSteps((cur) => cur.filter((x) => x.key !== s.key));
                      announce(`Passo ${i + 1} removido.`);
                    }}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
        <Button type="button" variant="outline" onClick={addStep} disabled={pending || steps.length >= 30}>
          <Plus /> Adicionar passo
        </Button>
        <p className="sr-only" aria-live="polite" role="status">
          {live}
        </p>
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href="/sequences" className="inline-flex h-9 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent">
          Cancelar
        </Link>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : mode === "create" ? "Criar sequência" : "Salvar alterações"}
        </Button>
      </div>
    </form>
  );
}
