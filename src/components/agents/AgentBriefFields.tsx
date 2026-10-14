"use client";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, type Control, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { PlatformManagedNote } from "@/components/billing/FeatureLockNotice";
import { BRIEF_COUNTS, type BriefFormValues } from "./agent-brief-form";

const areaCls = "min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20";

interface WithBrief { brief: BriefFormValues }
type BriefErrors = FieldErrors<WithBrief>["brief"];

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={`text-xs tabular-nums ${value.length > max ? "text-destructive" : "text-muted-foreground"}`} aria-hidden="true">{value.length}/{max}</span>;
}

/**
 * SPEC-069f — campos guiados do briefing do agente (oferta, publico, objecoes, o que nunca dizer, assinatura, exemplos). Cada um vira um campo
 * SEPARADO no prompt (ver `composeBriefLines`); nada aqui altera as regras do sistema, o modelo, o teto ou os limites (do admin).
 */
export function AgentBriefFields({ uid, register, control, errors, watchValues }: { uid: string; register: UseFormRegister<WithBrief>; control: Control<WithBrief>; errors: BriefErrors; watchValues: BriefFormValues }) {
  const objections = useFieldArray({ control, name: "brief.objections" });
  const examples = useFieldArray({ control, name: "brief.examples" });
  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">O que você vende e para quem</legend>
        <Field id={`${uid}-offer`} label="Oferta ou produto" hint="Em poucas frases: o que é, qual o benefício principal. Preços e prazos ficam na base de conhecimento." error={errors?.offer?.message}>
          {(f) => <textarea {...f} {...register("brief.offer")} className={areaCls} maxLength={BRIEF_COUNTS.offer} placeholder="Ex.: Sistema de agendamento online para clínicas, que reduz faltas com lembretes automáticos." />}
        </Field>
        <div className="-mt-2 text-right"><Counter value={watchValues.offer} max={BRIEF_COUNTS.offer} /></div>
        <Field id={`${uid}-aud`} label="Público ideal (ICP)" hint="Quem costuma comprar: segmento, porte, cargo." error={errors?.audience?.message}>
          {(f) => <textarea {...f} {...register("brief.audience")} className={areaCls} maxLength={BRIEF_COUNTS.audience} placeholder="Ex.: Donos de clínicas pequenas (1 a 5 profissionais) que ainda usam agenda de papel ou WhatsApp." />}
        </Field>
        <div className="-mt-2 text-right"><Counter value={watchValues.audience} max={BRIEF_COUNTS.audience} /></div>
      </fieldset>

      <fieldset className="grid gap-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Objeções comuns</legend>
        <p className="text-xs text-muted-foreground">O que o cliente costuma dizer e como você gostaria que o agente responda (até {BRIEF_COUNTS.objections}). Preencha os dois lados.</p>
        <ul className="grid gap-3">
          {objections.fields.map((f, i) => (
            <li key={f.id} className="grid gap-2 rounded-md border border-border/70 p-2">
              <Field id={`${uid}-ob-${i}`} label={`Objeção ${i + 1}`} error={errors?.objections?.[i]?.objection?.message}>
                {(p) => <Input {...p} {...register(`brief.objections.${i}.objection` as const)} maxLength={BRIEF_COUNTS.objectionText} placeholder="Ex.: Já uso outro sistema." />}
              </Field>
              <Field id={`${uid}-oa-${i}`} label="Como responder" error={errors?.objections?.[i]?.answer?.message}>
                {(p) => <textarea {...p} {...register(`brief.objections.${i}.answer` as const)} className={areaCls} maxLength={BRIEF_COUNTS.objectionAnswer} placeholder="Ex.: Entender o que falta no atual e mostrar a migração gratuita." />}
              </Field>
              <Button type="button" size="sm" variant="ghost" className="min-h-11 justify-self-start sm:min-h-8" onClick={() => objections.remove(i)} aria-label={`Remover objeção ${i + 1}`}><Trash2 /> Remover</Button>
            </li>
          ))}
        </ul>
        <Button type="button" size="sm" variant="outline" className="min-h-11 justify-self-start sm:min-h-8" disabled={objections.fields.length >= BRIEF_COUNTS.objections} onClick={() => objections.append({ objection: "", answer: "" })}><Plus /> Adicionar objeção</Button>
      </fieldset>

      <fieldset className="grid gap-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">O que nunca dizer</legend>
        <Field id={`${uid}-never`} label="Assuntos, promessas ou termos a evitar (um por linha)" hint={`Até ${BRIEF_COUNTS.neverSay} itens. É uma instrução ao agente; para bloquear frases exatas, use as "Frases proibidas" mais abaixo.`} error={errors?.neverSay?.message}>
          {(f) => <textarea {...f} {...register("brief.neverSay")} className={areaCls} placeholder={"Ex.:\nGarantir resultado\nComparar com concorrentes pelo nome"} />}
        </Field>
      </fieldset>

      <fieldset className="grid gap-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Assinatura e exemplos</legend>
        <Field id={`${uid}-sig`} label="Assinatura" hint="Como as mensagens terminam." error={errors?.signature?.message}>
          {(f) => <Input {...f} {...register("brief.signature")} maxLength={BRIEF_COUNTS.signature} placeholder="Ex.: Ana, da equipe Acme" />}
        </Field>
        <p className="text-xs text-muted-foreground">Exemplos de boa resposta (até {BRIEF_COUNTS.examples}): servem de referência de estilo, o agente não copia literalmente.</p>
        <ul className="grid gap-3">
          {examples.fields.map((f, i) => (
            <li key={f.id} className="grid gap-2">
              <Field id={`${uid}-ex-${i}`} label={`Exemplo ${i + 1}`}>
                {(p) => <textarea {...p} {...register(`brief.examples.${i}.text` as const)} className={areaCls} maxLength={BRIEF_COUNTS.example} placeholder="Ex.: Oi, Maria! Vi que a clínica atende só com agenda por WhatsApp. Posso te mostrar em 10 min como reduzir as faltas?" />}
              </Field>
              <Button type="button" size="sm" variant="ghost" className="min-h-11 justify-self-start sm:min-h-8" onClick={() => examples.remove(i)} aria-label={`Remover exemplo ${i + 1}`}><Trash2 /> Remover</Button>
            </li>
          ))}
        </ul>
        <Button type="button" size="sm" variant="outline" className="min-h-11 justify-self-start sm:min-h-8" disabled={examples.fields.length >= BRIEF_COUNTS.examples} onClick={() => examples.append({ text: "" })}><Plus /> Adicionar exemplo</Button>
      </fieldset>
      <PlatformManagedNote>Regras de segurança, modelo de IA, custo e limites são fixos e definidos pela plataforma: o briefing não os altera.</PlatformManagedNote>
    </div>
  );
}
