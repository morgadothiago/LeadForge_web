"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CAMPAIGN_STATUS_LABELS } from "@/lib/domain";
import { createCampaign, updateCampaign } from "@/lib/actions/campaign";
import type { ActionResult, FieldErrors } from "@/lib/actions/result";
import { Field } from "./Field";
import { IcpFields } from "./IcpFields";
import { OptionSelect } from "./OptionSelect";
import { EMPTY_ICP, fieldError, toIcpInput, type IcpValues } from "./form-utils";

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
  };
  icps: { id: string; name: string; niche: string }[];
  sequences: { id: string; name: string }[];
  whatsappInstances: { id: string; instanceName: string }[];
}

const STATUS_OPTIONS = (Object.keys(CAMPAIGN_STATUS_LABELS) as (keyof typeof CAMPAIGN_STATUS_LABELS)[]).map((v) => ({
  value: v,
  label: CAMPAIGN_STATUS_LABELS[v],
}));

export function CampaignForm({ mode, campaign, icps, sequences, whatsappInstances }: Props) {
  const router = useRouter();
  const [name, setName] = React.useState(campaign?.name ?? "");
  const [description, setDescription] = React.useState(campaign?.description ?? "");
  const [status, setStatus] = React.useState<string | null>(campaign?.status ?? "active");
  const [sequenceId, setSequenceId] = React.useState<string | null>(campaign?.sequenceId ?? null);
  const [waId, setWaId] = React.useState<string | null>(campaign?.whatsappInstanceId ?? null);
  const [icpMode, setIcpMode] = React.useState<"existing" | "new">(icps.length === 0 && mode === "create" ? "new" : "existing");
  const [icpId, setIcpId] = React.useState<string | null>(campaign?.icpId ?? null);
  const [icp, setIcp] = React.useState<IcpValues>(EMPTY_ICP);

  const [state, action, pending] = React.useActionState(
    async (): Promise<ActionResult<{ id: string }>> => {
      const base = { name, description, sequenceId, whatsappInstanceId: waId };
      if (mode === "edit" && campaign) {
        return updateCampaign({ ...base, id: campaign.id, status, icpId });
      }
      return createCampaign({
        ...base,
        status,
        ...(icpMode === "new" ? { icp: toIcpInput(icp) } : { icpId }),
      });
    },
    null,
  );

  React.useEffect(() => {
    if (state?.ok) {
      toast.success(mode === "create" ? "Campanha criada." : "Campanha atualizada.");
      router.push("/campanhas");
    }
  }, [state, mode, router]);

  const errors: FieldErrors | undefined = state && !state.ok ? state.errors : undefined;
  const formError = fieldError(errors, "_form");

  return (
    <form action={action} className="mx-auto max-w-3xl space-y-6" noValidate>
      {formError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}

      <Card className="space-y-4 p-5">
        <h2 className="font-heading text-base font-semibold">Dados da campanha</h2>
        <Field id="c-name" label="Nome" required error={fieldError(errors, "name")}>
          {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Sites para Advogados" maxLength={120} />}
        </Field>
        <Field id="c-desc" label="Descrição" error={fieldError(errors, "description")}>
          {(a) => (
            <textarea
              {...a}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-[3px] focus:ring-primary/20 aria-invalid:border-destructive"
            />
          )}
        </Field>
        <Field id="c-status" label="Status" error={fieldError(errors, "status")}>
          {(a) => (
            <OptionSelect
              id={a.id}
              value={status}
              onChange={setStatus}
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
            <Field id="c-icp" label="ICP" required error={fieldError(errors, "icpId")}>
              {(a) => (
                <OptionSelect
                  id={a.id}
                  value={icpId}
                  onChange={setIcpId}
                  options={icps.map((i) => ({ value: i.id, label: `${i.name} · ${i.niche}` }))}
                  placeholder="Selecione um ICP"
                  invalid={a["aria-invalid"]}
                  describedBy={a["aria-describedby"]}
                />
              )}
            </Field>
          )
        ) : (
          <IcpFields idPrefix="c-icp" prefix="icp." values={icp} onChange={setIcp} errors={errors} />
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-heading text-base font-semibold">Integrações (opcional)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="c-seq"
            label="Sequência"
            error={fieldError(errors, "sequenceId")}
            hint={sequences.length === 0 ? "Nenhuma sequência disponível ainda — o módulo de sequências chega em breve." : undefined}
          >
            {(a) => (
              <OptionSelect
                id={a.id}
                value={sequenceId}
                onChange={setSequenceId}
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
            error={fieldError(errors, "whatsappInstanceId")}
            hint={whatsappInstances.length === 0 ? "Nenhuma instância conectada — a integração com WhatsApp chega em breve." : undefined}
          >
            {(a) => (
              <OptionSelect
                id={a.id}
                value={waId}
                onChange={setWaId}
                options={whatsappInstances.map((w) => ({ value: w.id, label: w.instanceName }))}
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
