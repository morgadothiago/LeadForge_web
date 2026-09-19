"use client";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/campaigns/Field";
import { OptionSelect } from "@/components/campaigns/OptionSelect";
import { CHANNELS, CHANNEL_LABELS, type ChannelKey } from "@/lib/domain";
import type { TemplatePreview } from "@/lib/actions/template";
import type { StepDraft, TemplateOption } from "./types";

const CHANNEL_OPTIONS = CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] }));

export interface StepRowProps {
  step: StepDraft;
  index: number;
  total: number;
  templates: TemplateOption[];
  preview?: TemplatePreview | { error: string } | "loading";
  errors: { day?: string; templateId?: string };
  disabled?: boolean;
  onChange: (patch: Partial<StepDraft>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}

export function StepRow({ step, index, total, templates, preview, errors, disabled, onChange, onMove, onRemove }: StepRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: step.key });
  const n = index + 1;
  const options = templates.map((t) => ({ value: t.id, label: `${t.name} · ${t.campaignName}` }));

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 opacity-80" : undefined}
    >
      <Card className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={`Arrastar passo ${n}. Use espaço para pegar e setas para mover.`}
              className="inline-flex size-9 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <GripVertical className="size-4" aria-hidden="true" />
            </button>
            <h3 className="font-heading text-sm font-semibold">Passo {n}</h3>
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" aria-label={`Mover passo ${n} para cima`} disabled={disabled || index === 0} onClick={() => onMove(-1)}>
              <ArrowUp />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label={`Mover passo ${n} para baixo`} disabled={disabled || index === total - 1} onClick={() => onMove(1)}>
              <ArrowDown />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remover passo ${n}`} disabled={disabled} onClick={onRemove}>
              <Trash2 className="text-destructive" />
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[6rem_10rem_1fr]">
          <Field id={`s${step.key}-day`} label="Dia" required error={errors.day}>
            {(a) => (
              <Input
                {...a}
                type="number"
                inputMode="numeric"
                min={0}
                max={365}
                value={Number.isNaN(step.day) ? "" : step.day}
                disabled={disabled}
                onChange={(e) => onChange({ day: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
              />
            )}
          </Field>
          <Field id={`s${step.key}-ch`} label="Canal" required>
            {(a) => (
              <OptionSelect
                id={a.id}
                value={step.channel}
                onChange={(v) => v && onChange({ channel: v as ChannelKey, templateId: null })}
                options={CHANNEL_OPTIONS}
                placeholder="Canal"
                disabled={disabled}
              />
            )}
          </Field>
          <Field
            id={`s${step.key}-tpl`}
            label="Template"
            required
            error={errors.templateId}
            hint={options.length === 0 ? "Nenhum template disponível para este canal e campanha." : undefined}
          >
            {(a) => (
              <OptionSelect
                id={a.id}
                value={step.templateId}
                onChange={(v) => onChange({ templateId: v })}
                options={options}
                placeholder="Selecione um template"
                disabled={disabled}
                invalid={a["aria-invalid"]}
                describedBy={a["aria-describedby"]}
              />
            )}
          </Field>
        </div>

        {step.templateId && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm" aria-live="polite">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Pré-visualização (lead de exemplo)</p>
            {preview === undefined || preview === "loading" ? (
              <p className="text-muted-foreground">Carregando…</p>
            ) : "error" in preview ? (
              <p className="text-destructive">{preview.error}</p>
            ) : (
              <>
                {preview.subject && <p className="mb-1 font-medium">{preview.subject}</p>}
                <p className="whitespace-pre-wrap break-words">{preview.body}</p>
                {preview.missing.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">Sem valor no exemplo: {preview.missing.join(", ")}.</p>
                )}
              </>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}
