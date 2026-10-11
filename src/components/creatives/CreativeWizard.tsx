"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check, Loader2, Send, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import type { FieldErrors } from "@/lib/actions/result";
import { createWizardSubmitter } from "./creative-lifecycle";
import { applyServerErrors } from "@/components/org/org-format";
import { createCreativeDraft, submitCreative } from "@/lib/actions/creative";
import type { CreateCreativeDraftInput } from "@/lib/schemas/creative";
import { CREATIVE_ASPECT_RATIOS, CREATIVE_LANGUAGES, type AvatarsAndVoices, type CreativeAspectRatio, type CreativeLanguage } from "@/lib/creatives/types";
import { cn } from "@/lib/utils";
import { buildCreativeFormSchema } from "./creative-form-schema";
import { MockProviderNotice } from "./MockProviderNotice";
import {
  ASPECT_LABEL,
  GENDER_LABEL,
  LANGUAGE_LABEL,
  WIZARD_STEPS,
  estimateDurationSec,
  formatCents,
  formatDuration,
  isMockProvider,
  quotaSummary,
  stepOfFirstError,
  voicesFor,
  type WizardFieldName,
} from "./creative-format";

const FIELDS = ["title", "script", "language", "voiceRef", "avatarRef", "aspectRatio", "durationSec"] as const;
const choiceCls =
  "flex cursor-pointer gap-3 rounded-lg border border-border bg-card p-3 text-sm transition-colors hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40";

/**
 * SPEC-051b — criação em passos (roteiro -> avatar -> voz/idioma -> formato -> revisão). Um único `useForm`
 * (RHF + zodResolver, `createCreativeDraftSchema` + teto de caracteres da config); cada passo valida só os seus campos
 * (`trigger`). Ao final: `createCreativeDraft` e `submitCreative`. Se o envio falhar (limite/cota), o rascunho já existe:
 * leva à página do criativo, onde "Enviar" pode ser repetido.
 */
export function CreativeWizard({ info }: { info: AvatarsAndVoices }) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [pending, startTransition] = React.useTransition();
  const schema = React.useMemo(() => buildCreativeFormSchema(info.limits), [info.limits]);
  const {
    register,
    control,
    handleSubmit,
    trigger,
    setValue,
    getValues,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<CreateCreativeDraftInput>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", script: "", language: "pt-BR", avatarRef: "", voiceRef: "", aspectRatio: "9:16" },
  });
  const v = useWatch({ control }) as Partial<CreateCreativeDraftInput>;
  const script = v.script ?? "";
  const language = (v.language ?? "pt-BR") as CreativeLanguage;
  const estimated = estimateDurationSec(script);
  const voices = voicesFor(info.voices, language);
  const quota = quotaSummary(info);
  const mock = isMockProvider(info.provider);
  const last = step === WIZARD_STEPS.length - 1;
  const avatar = info.avatars.find((a) => a.id === v.avatarRef);
  const voice = info.voices.find((x) => x.id === v.voiceRef);

  async function next() {
    const ok = await trigger([...WIZARD_STEPS[step].fields] as WizardFieldName[]);
    if (!ok) return;
    if (estimated > info.limits.maxDurationSec && step === 0) {
      setError("script", { type: "validate", message: `O roteiro estimado em ${formatDuration(estimated)} passa do máximo de ${formatDuration(info.limits.maxDurationSec)}. Encurte o texto.` });
      return;
    }
    setStep((s) => s + 1);
  }

  // Ref do rascunho + trava de duplo envio (lógica pura em creative-lifecycle.ts).
  const [submitter] = React.useState(() =>
    createWizardSubmitter<CreateCreativeDraftInput, FieldErrors>({
      createDraft: (values) => createCreativeDraft(values),
      submit: (id) => submitCreative(id),
    }),
  );

  // Foco no título do passo ao avançar/voltar (não na montagem; o 1º passo tem autoFocus no título do criativo).
  // Compara com o passo anterior (não com um booleano) para sobreviver ao double-effect do StrictMode.
  const prevStep = React.useRef(step);
  React.useEffect(() => {
    if (prevStep.current === step) return;
    prevStep.current = step;
    document.getElementById("creative-step-heading")?.focus();
  }, [step]);

  const onSubmit = handleSubmit((values) => {
    if (quota.blockedReason) return;
    startTransition(async () => {
      const out = await submitter.run(values);
      switch (out.kind) {
        case "busy":
          return;
        case "draft_threw":
          toast.error("Não foi possível salvar o rascunho. Verifique sua conexão e tente de novo.");
          return;
        case "draft_error": {
          const msg = applyServerErrors(out.errors, setError, setFocus, FIELDS);
          const target = stepOfFirstError(out.errors);
          if (target >= 0) setStep(target);
          toast.error(msg);
          return;
        }
        case "not_sent":
          toast.error(`Rascunho salvo, mas não foi enviado: ${out.errors._form?.[0] ?? Object.values(out.errors).flat()[0] ?? "tente novamente."}`);
          break;
        case "submit_threw":
          toast.error("Rascunho salvo, mas não conseguimos confirmar o envio. Confira o status e use \"Enviar para geração\" se preciso.");
          break;
        case "sent":
          toast.success("Criativo enviado para geração.");
          break;
      }
      router.push(`/criativos/${out.id}`);
    });
  });

  return (
    <form onSubmit={(e) => (last ? onSubmit(e) : (e.preventDefault(), void next()))} noValidate className="mx-auto max-w-2xl space-y-6">
      {mock && <MockProviderNotice />}

      <p role="status" aria-live="polite" className="sr-only">
        Etapa {step + 1} de {WIZARD_STEPS.length}: {WIZARD_STEPS[step].label}
      </p>
      <nav aria-label="Etapas">
        <ol className="flex items-center gap-1 overflow-x-auto pb-1 text-xs sm:text-sm">
          {WIZARD_STEPS.map((s, i) => (
            <li key={s.key} aria-current={i === step ? "step" : undefined} className="flex shrink-0 items-center gap-1">
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border text-xs font-medium",
                  i < step && "border-primary bg-primary text-primary-foreground",
                  i === step && "border-primary text-primary",
                  i > step && "border-border text-muted-foreground",
                )}
              >
                {i < step ? <Check aria-hidden="true" className="size-3" /> : i + 1}
              </span>
              <span className={cn("mr-2", i === step ? "font-medium" : "hidden text-muted-foreground sm:inline")}>{s.label}</span>
            </li>
          ))}
        </ol>
      </nav>

      <Card className="space-y-5 p-5">
        {errors.root?.message && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errors.root.message}
          </p>
        )}

        {step === 0 && (
          <div className="grid gap-4">
            <StepTitle title="Roteiro" desc="O que o avatar vai falar." />
            <Field id="creative-title" label="Título" required error={errors.title?.message} hint="Só para você identificar na biblioteca.">
              {(a) => <Input {...a} {...register("title")} maxLength={120} autoFocus placeholder="Ex.: Apresentação para clínicas" />}
            </Field>
            <Field id="creative-script" label="Roteiro" required error={errors.script?.message}>
              {(a) => (
                <textarea
                  {...a}
                  {...register("script")}
                  rows={8}
                  placeholder="Escreva o texto que o avatar vai falar."
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 aria-invalid:border-destructive"
                />
              )}
            </Field>
            <p aria-live="polite" className={cn("text-xs", script.length > info.limits.maxScriptChars ? "text-destructive" : "text-muted-foreground")}>
              {script.length} / {info.limits.maxScriptChars} caracteres · duração estimada: {estimated ? formatDuration(estimated) : "—"} (máx. {formatDuration(info.limits.maxDurationSec)})
            </p>
          </div>
        )}

        {step === 1 && (
          <fieldset className="grid gap-3" aria-describedby={errors.avatarRef ? "avatar-error" : undefined}>
            <legend className="mb-1">
              <StepTitle title="Avatar" desc="Quem vai apresentar o vídeo." />
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {info.avatars.map((a) => (
                <label key={a.id} className={choiceCls}>
                  <input type="radio" value={a.id} {...register("avatarRef")} className="sr-only" />
                  {a.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.previewUrl} alt="" className="size-10 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <User className="size-5" />
                    </span>
                  )}
                  <span className="self-center font-medium">{a.name}</span>
                </label>
              ))}
            </div>
            {info.avatars.length === 0 && <p className="text-sm text-muted-foreground">Nenhum avatar disponível no momento.</p>}
            {errors.avatarRef?.message && (
              <p id="avatar-error" role="alert" className="text-xs text-destructive">
                {errors.avatarRef.message}
              </p>
            )}
          </fieldset>
        )}

        {step === 2 && (
          <div className="grid gap-4">
            <StepTitle title="Voz e idioma" desc="O idioma define as vozes disponíveis." />
            <Field id="creative-language" label="Idioma" required error={errors.language?.message}>
              {(a) => (
                <select
                  {...a}
                  {...register("language", {
                    onChange: (e) => {
                      const lang = e.target.value as CreativeLanguage;
                      if (!voicesFor(info.voices, lang).some((x) => x.id === getValues("voiceRef"))) setValue("voiceRef", "");
                    },
                  })}
                  className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
                >
                  {CREATIVE_LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABEL[l]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <fieldset className="grid gap-2" aria-describedby={errors.voiceRef ? "voice-error" : undefined}>
              <legend className="mb-1 text-sm font-medium">Voz</legend>
              {voices.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma voz disponível para este idioma.</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                {voices.map((x) => (
                  <label key={x.id} className={choiceCls}>
                    <input type="radio" value={x.id} {...register("voiceRef")} className="sr-only" />
                    <span className="font-medium">{x.name}</span>
                    {x.gender && <span className="text-muted-foreground">voz {GENDER_LABEL[x.gender]}</span>}
                  </label>
                ))}
              </div>
              {errors.voiceRef?.message && (
                <p id="voice-error" role="alert" className="text-xs text-destructive">
                  {errors.voiceRef.message}
                </p>
              )}
            </fieldset>
          </div>
        )}

        {step === 3 && (
          <fieldset className="grid gap-3">
            <legend className="mb-1">
              <StepTitle title="Formato" desc="Onde o vídeo será exibido." />
            </legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {CREATIVE_ASPECT_RATIOS.map((r) => (
                <label key={r} className={cn(choiceCls, "flex-col items-center text-center")}>
                  <input type="radio" value={r} {...register("aspectRatio")} className="sr-only" />
                  <span aria-hidden="true" className={cn("w-10 rounded border-2 border-current text-muted-foreground", r === "9:16" ? "h-16" : r === "1:1" ? "h-10" : "h-6")} />
                  <span className="font-medium">{ASPECT_LABEL[r].name}</span>
                  <span className="text-xs text-muted-foreground">{ASPECT_LABEL[r].hint}</span>
                </label>
              ))}
            </div>
            {errors.aspectRatio?.message && (
              <p role="alert" className="text-xs text-destructive">
                {errors.aspectRatio.message}
              </p>
            )}
          </fieldset>
        )}

        {last && (
          <div className="grid gap-4">
            <StepTitle title="Revisão" desc="Confira antes de enviar para geração." />
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Row label="Título" value={v.title} />
              <Row label="Avatar" value={avatar?.name} />
              <Row label="Idioma" value={LANGUAGE_LABEL[language]} />
              <Row label="Voz" value={voice?.name} />
              <Row label="Formato" value={ASPECT_LABEL[(v.aspectRatio ?? "9:16") as CreativeAspectRatio].name} />
              <Row label="Duração estimada" value={formatDuration(estimated)} />
              <Row label="Custo estimado" value={mock ? `${formatCents(0)} (demonstração)` : "Informado pelo provedor após o envio"} />
              <Row label="Cota do mês" value={`${info.usage.usedThisMonth} de ${info.limits.maxPerMonthPerOrg} usados; este envio usa 1`} />
            </dl>
            <div>
              <p className="text-sm font-medium">Roteiro</p>
              <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2 text-sm">{script}</p>
            </div>
            {quota.blockedReason && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {quota.blockedReason}
              </p>
            )}
          </div>
        )}
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button type="button" variant="outline" onClick={() => (step === 0 ? router.push("/criativos") : setStep(step - 1))} disabled={pending}>
          <ArrowLeft aria-hidden="true" /> {step === 0 ? "Cancelar" : "Voltar"}
        </Button>
        {last ? (
          // `key` distinto: sem ele o React reaproveita o MESMO <button> do "Continuar" e ele vira submit no meio do clique,
          // enviando o criativo ao entrar na revisão (bug visto em navegador real).
          <Button key="submit" type="submit" disabled={pending || Boolean(quota.blockedReason)} aria-busy={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            {pending ? "Enviando..." : "Criar e enviar"}
          </Button>
        ) : (
          <Button key="next" type="button" onClick={next}>
            Continuar <ArrowRight aria-hidden="true" />
          </Button>
        )}
      </div>
    </form>
  );
}

function StepTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h2 id="creative-step-heading" tabIndex={-1} className="font-heading text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium">{value || "—"}</dd>
    </div>
  );
}
