"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldPath } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CAMPAIGN_STATUS_LABELS } from "@/lib/domain";
import { createCampaign, updateCampaign } from "@/lib/actions/campaign";
import { campaignCreateSchema, campaignUpdateSchema } from "@/lib/schemas/campaign";
import type { FieldErrors } from "@/lib/actions/result";
import { AUTO_START_WARNING } from "@/components/sequences/sequence-start-format";
import { Field } from "./Field";
import { IcpFields } from "./IcpFields";
import { OptionSelect } from "./OptionSelect";
import { EMPTY_ICP, getFormError, toIcpInput, type IcpValues } from "./form-utils";

interface Props {
  mode: "create" | "edit";
  campaign?: {
    id: string;
    name: string;
    description: string | null;
    status: "active" | "paused" | "archived";
    icpId: string;
    sequenceId: string | null;
    whatsappInstanceId: string | null;
    autoStart?: boolean;
  };
  icps: { id: string; name: string; niche: string }[];
  sequences: { id: string; name: string }[];
  whatsappInstances: { id: string; instanceName: string; status?: "connected" | "connecting" | "disconnected" }[];
}

const STATUS_OPTIONS = (Object.keys(CAMPAIGN_STATUS_LABELS) as (keyof typeof CAMPAIGN_STATUS_LABELS)[]).map((v) => ({
  value: v,
  label: CAMPAIGN_STATUS_LABELS[v],
}));

/** Valores do formulário (SPEC-043): listas do ICP ficam como texto com vírgula na UI e viram arrays no submit. */
interface CampaignFormValues {
  name: string;
  description: string;
  status: "active" | "paused" | "archived";
  sequenceId: string | null;
  whatsappInstanceId: string | null;
  autoStart: boolean;
  icpId: string | null;
  icp: IcpValues;
}

type CampaignSubmit = z.output<typeof campaignCreateSchema> | z.output<typeof campaignUpdateSchema>;

function toCreateInput(v: CampaignFormValues, icpMode: "existing" | "new"): z.input<typeof campaignCreateSchema> {
  const base = {
    name: v.name,
    description: v.description,
    status: v.status,
    sequenceId: v.sequenceId,
    whatsappInstanceId: v.whatsappInstanceId,
    autoStart: v.autoStart,
  };
  return icpMode === "new" ? { ...base, icp: toIcpInput(v.icp) } : { ...base, icpId: v.icpId ?? undefined };
}

function toUpdateInput(v: CampaignFormValues, id: string): z.input<typeof campaignUpdateSchema> {
  return {
    id,
    name: v.name,
    description: v.description,
    status: v.status,
    sequenceId: v.sequenceId,
    whatsappInstanceId: v.whatsappInstanceId,
    autoStart: v.autoStart,
    icpId: v.icpId ?? "",
  };
}

export function CampaignForm({ mode, campaign, icps, sequences, whatsappInstances }: Props) {
  const router = useRouter();
  const [icpMode, setIcpMode] = React.useState<"existing" | "new">(icps.length === 0 && mode === "create" ? "new" : "existing");
  const [pending, startTransition] = React.useTransition();
  const campaignId = campaign?.id;

  const resolver = React.useMemo(
    () =>
      mode === "edit" && campaignId
        ? zodResolver(z.preprocess((v: CampaignFormValues) => toUpdateInput(v, campaignId), campaignUpdateSchema))
        : zodResolver(z.preprocess((v: CampaignFormValues) => toCreateInput(v, icpMode), campaignCreateSchema)),
    [mode, campaignId, icpMode],
  );

  const { register, handleSubmit, setError, setFocus, watch, setValue, formState } = useForm<CampaignFormValues, unknown, CampaignSubmit>({
    resolver,
    defaultValues: {
      name: campaign?.name ?? "",
      description: campaign?.description ?? "",
      status: campaign?.status ?? "active",
      sequenceId: campaign?.sequenceId ?? null,
      whatsappInstanceId: campaign?.whatsappInstanceId ?? null,
      autoStart: campaign?.autoStart ?? false,
      icpId: campaign?.icpId ?? null,
      icp: EMPTY_ICP,
    },
  });
  const { errors } = formState;

  const status = watch("status");
  const icpId = watch("icpId");
  const sequenceId = watch("sequenceId");
  const waId = watch("whatsappInstanceId");
  const autoStart = watch("autoStart");

  function applyServerErrors(errs: FieldErrors) {
    let first: FieldPath<CampaignFormValues> | undefined;
    for (const [key, msgs] of Object.entries(errs)) {
      if (key === "_form") continue;
      const path = key as FieldPath<CampaignFormValues>;
      first ??= path;
      setError(path, { type: "server", message: msgs.join(" ") });
    }
    if (errs._form) setError("root", { type: "server", message: errs._form.join(" ") });
    const msg = getFormError(errs);
    toast.error(msg);
    if (first) setFocus(first.replace(/\.\d+$/, "") as FieldPath<CampaignFormValues>);
  }

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const r = mode === "edit" && campaignId ? await updateCampaign(values) : await createCampaign(values);
      if (r.ok) {
        toast.success(mode === "create" ? "Campanha criada." : "Campanha atualizada.");
        router.push("/campanhas");
        return;
      }
      applyServerErrors(r.errors);
    });
  });

  const icpRegister = (n: string): ReturnType<typeof register> => register(n as FieldPath<CampaignFormValues>);

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-3xl space-y-6" noValidate>
      {errors.root?.message && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root.message}
        </p>
      )}

      <Card className="space-y-4 p-5">
        <h2 className="font-heading text-base font-semibold">Dados da campanha</h2>
        <Field id="c-name" label="Nome" required error={errors.name?.message}>
          {(a) => <Input {...a} {...register("name")} placeholder="Ex.: Sites para Advogados" maxLength={120} />}
        </Field>
        <Field id="c-desc" label="Descrição" error={errors.description?.message}>
          {(a) => (
            <textarea
              {...a}
              {...register("description")}
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-[3px] focus:ring-primary/20 aria-invalid:border-destructive"
            />
          )}
        </Field>
        <Field id="c-status" label="Status" error={errors.status?.message}>
          {(a) => (
            <OptionSelect
              id={a.id}
              value={status}
              onChange={(v) => v && setValue("status", v as CampaignFormValues["status"])}
              options={STATUS_OPTIONS}
              placeholder="Selecione"
              invalid={a["aria-invalid"]}
              describedBy={a["aria-describedby"]}
            />
          )}
        </Field>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-base font-semibold">Perfil de cliente ideal (ICP)</h2>
          {mode === "create" && (
            <div role="radiogroup" aria-label="Origem do ICP" className="inline-flex rounded-md border border-border p-0.5">
              {(["existing", "new"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={icpMode === m}
                  onClick={() => setIcpMode(m)}
                  className={`h-8 rounded-sm px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                    icpMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "existing" ? "Usar existente" : "Criar novo"}
                </button>
              ))}
            </div>
          )}
        </div>
        {icpMode === "existing" ? (
          icps.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum ICP cadastrado ainda. Escolha “Criar novo”.</p>
          ) : (
            <Field id="c-icp" label="ICP" required error={errors.icpId?.message}>
              {(a) => (
                <OptionSelect
                  id={a.id}
                  value={icpId}
                  onChange={(v) => setValue("icpId", v)}
                  options={icps.map((i) => ({ value: i.id, label: `${i.name} · ${i.niche}` }))}
                  placeholder="Selecione um ICP"
                  invalid={a["aria-invalid"]}
                  describedBy={a["aria-describedby"]}
                />
              )}
            </Field>
          )
        ) : (
          <IcpFields idPrefix="c-icp" prefix="icp." register={icpRegister} errors={errors} />
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-heading text-base font-semibold">Integrações (opcional)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="c-seq"
            label="Sequência"
            error={errors.sequenceId?.message}
            hint={sequences.length === 0 ? "Nenhuma sequência disponível ainda — o módulo de sequências chega em breve." : undefined}
          >
            {(a) => (
              <OptionSelect
                id={a.id}
                value={sequenceId}
                onChange={(v) => setValue("sequenceId", v)}
                options={sequences.map((s) => ({ value: s.id, label: s.name }))}
                placeholder="Sem sequência"
                allowNone
                disabled={sequences.length === 0}
                invalid={a["aria-invalid"]}
                describedBy={a["aria-describedby"]}
              />
            )}
          </Field>
          <Field
            id="c-wa"
            label="Instância de WhatsApp"
            error={errors.whatsappInstanceId?.message}
            hint={
              whatsappInstances.length === 0
                ? "Nenhuma instância cadastrada. Crie uma em Configurações > WhatsApp."
                : "Só instâncias conectadas enviam mensagens; se estiver desconectada, os envios ficam adiados."
            }
          >
            {(a) => (
              <OptionSelect
                id={a.id}
                value={waId}
                onChange={(v) => setValue("whatsappInstanceId", v)}
                options={whatsappInstances.map((w) => ({
                  value: w.id,
                  label: w.status ? `${w.instanceName} (${{ connected: "conectada", connecting: "conectando", disconnected: "desconectada" }[w.status]})` : w.instanceName,
                }))}
                placeholder="Sem WhatsApp"
                allowNone
                disabled={whatsappInstances.length === 0}
                invalid={a["aria-invalid"]}
                describedBy={a["aria-describedby"]}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-heading text-base font-semibold">Início dos leads</h2>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <label htmlFor="c-autostart" id="c-autostart-label" className="text-sm font-medium">
              Iniciar leads automaticamente
            </label>
            <p id="c-autostart-hint" className="text-xs text-muted-foreground">
              Desligado: você inicia a sequência manualmente (na campanha ou em cada lead). Ligado: o scheduler inicia sozinho os leads elegíveis.
            </p>
          </div>
          <button
            id="c-autostart"
            type="button"
            role="switch"
            aria-checked={autoStart}
            aria-labelledby="c-autostart-label"
            aria-describedby="c-autostart-hint"
            onClick={() => setValue("autoStart", !autoStart)}
            className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 ${autoStart ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white transition-transform ${autoStart ? "translate-x-5" : ""}`} />
          </button>
        </div>
        {autoStart && (
          <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            {AUTO_START_WARNING}
          </p>
        )}
        {errors.autoStart?.message && <p className="text-xs text-destructive">{errors.autoStart.message}</p>}
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href="/campanhas" className="inline-flex h-9 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent">
          Cancelar
        </Link>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : mode === "create" ? "Criar campanha" : "Salvar alterações"}
        </Button>
      </div>
    </form>
  );
}
