"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, CircleDashed, Copy, Eye, EyeOff, Loader2, Pencil, Plus, Trash2, Webhook } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { Field } from "@/components/campaigns/Field";
import { getFormError } from "@/components/campaigns/form-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { removeLeadSourceBinding, saveLeadSourceBinding } from "@/lib/actions/lead-source";
import type { LeadSourceBindingView, LeadSourceCampaignOption } from "@/lib/queries/lead-source";
import {
  saveLeadSourceBindingSchema,
  type LeadSourceBindingInput,
  type LeadSourceProviderName,
  type LeadSourceBindingValues,
} from "@/lib/schemas/lead-source";
import { maskHint } from "./integration-format";

/**
 * SPEC-041 / D-041-4 — os 2 cartões novos da seção "Captação de leads" (Configurações > Integrações),
 * no mesmo padrão visual de `IntegrationCard`. Cada cartão mostra o webhook (sem segredo na URL), o
 * estado das flags/env do servidor, os vínculos cadastrados e um formulário RHF + zodResolver
 * (SPEC-042) que faz upsert do vínculo — no Meta, junto com o Page Access Token.
 */
const selectCls =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20";

const CARD = {
  google_ads: {
    title: "Google Ads Lead Form",
    idLabel: "google_key",
    idHint: "Cole o google_key da extensão de formulário do Google Ads. O próprio identificador autentica o webhook (não há segredo).",
    path: "/api/integrations/leads/google-ads",
    flag: "INTEGRATION_LEADS_GOOGLE_ADS_ENABLED",
    risk: "Dependência externa: o Google pode exigir verificação da plataforma antes do tráfego real em produção.",
  },
  meta: {
    title: "Meta Lead Ads",
    idLabel: "ID da Página (page_id)",
    idHint: "ID numérico da Página do Facebook/Instagram que recebe os leadgen (Facebook Developers > Page > ID).",
    path: "/api/integrations/leads/meta",
    flag: "INTEGRATION_LEADS_META_ENABLED",
    risk: "Dependência externa: o App Review do Facebook é obrigatório para aceitar leadgen em produção (o modo teste só vale para usuários do app).",
  },
} as const satisfies Record<LeadSourceProviderName, { title: string; idLabel: string; idHint: string; path: string; flag: string; risk: string }>;

export interface LeadSourceFlags {
  googleAdsEnabled: boolean;
  metaEnabled: boolean;
  /** `META_APP_SECRET`/`META_WEBHOOK_VERIFY_TOKEN` são env-only (não ficam no painel) — só mostramos presença. */
  metaAppSecret: boolean;
  metaVerifyToken: boolean;
  baseUrl: string | null;
}

export function LeadSourceCards({
  bindings,
  campaigns,
  flags,
}: {
  bindings: LeadSourceBindingView[];
  campaigns: LeadSourceCampaignOption[];
  flags: LeadSourceFlags;
}) {
  const [announce, setAnnounce] = React.useState("");
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      <ul className="grid gap-4 lg:grid-cols-2">
        {(["google_ads", "meta"] as const).map((provider) => (
          <li key={provider}>
            <LeadSourceCard
              provider={provider}
              bindings={bindings.filter((b) => b.provider === provider)}
              campaigns={campaigns}
              flags={flags}
              onAnnounce={setAnnounce}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

function LeadSourceCard({
  provider,
  bindings,
  campaigns,
  flags,
  onAnnounce,
}: {
  provider: LeadSourceProviderName;
  bindings: LeadSourceBindingView[];
  campaigns: LeadSourceCampaignOption[];
  flags: LeadSourceFlags;
  onAnnounce: (m: string) => void;
}) {
  const router = useRouter();
  const cfg = CARD[provider];
  const enabled = provider === "google_ads" ? flags.googleAdsEnabled : flags.metaEnabled;
  const [editing, setEditing] = React.useState<LeadSourceBindingView | null>(null);
  const [confirmDel, setConfirmDel] = React.useState<LeadSourceBindingView | null>(null);
  const [delError, setDelError] = React.useState<string>();
  const [delPending, startDel] = React.useTransition();
  const [pending, startTransition] = React.useTransition();
  const [reveal, setReveal] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(copyTimer.current), []);

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    reset,
    formState: { errors },
  } = useForm<LeadSourceBindingInput, unknown, LeadSourceBindingValues>({
    resolver: zodResolver(saveLeadSourceBindingSchema),
    defaultValues: { provider, externalAccountId: "", label: "", campaignId: "", pageToken: "" },
  });

  const url = flags.baseUrl ? `${flags.baseUrl}${cfg.path}` : cfg.path;
  const tokenRequired = !editing || !editing.tokenHint;
  const tokenHintText = !editing
    ? "Token de longa duração da Página (Facebook Developers > Access Tokens). Sem ele os dados do lead não são importados."
    : editing.tokenHint
      ? `Token atual: ${maskHint(editing.tokenHint)} — deixe em branco para mantê-lo.`
      : "Ainda não há token salvo: informe o Page Access Token da Página.";

  function resetForm(b: LeadSourceBindingView | null) {
    setReveal(false);
    setEditing(b);
    reset({ provider, externalAccountId: b?.externalAccountId ?? "", label: b?.label ?? "", campaignId: b?.campaignId ?? "", pageToken: "" });
  }

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const r = await saveLeadSourceBinding(values);
      if (r.ok) {
        const msg = editing ? `${cfg.title}: vínculo atualizado.` : `${cfg.title}: vínculo salvo.`;
        toast.success(msg);
        onAnnounce(msg);
        resetForm(null);
        router.refresh();
        return;
      }
      let firstField: keyof LeadSourceBindingInput | undefined;
      for (const [key, msgs] of Object.entries(r.errors)) {
        if (key === "_form") continue;
        firstField ??= key as keyof LeadSourceBindingInput;
        setError(key as keyof LeadSourceBindingInput, { type: "server", message: msgs.join(" ") });
      }
      if (r.errors._form) setError("root", { type: "server", message: r.errors._form.join(" ") });
      const msg = getFormError(r.errors);
      toast.error(msg);
      onAnnounce(msg);
      if (firstField) setFocus(firstField);
    });
  });

  function remove() {
    if (!confirmDel) return;
    setDelError(undefined);
    startDel(async () => {
      const r = await removeLeadSourceBinding({ id: confirmDel.id, confirm: true });
      if (r.ok) {
        const msg = `${cfg.title}: vínculo removido.`;
        toast.success(msg);
        onAnnounce(msg);
        setConfirmDel(null);
        if (editing?.id === confirmDel.id) resetForm(null);
        router.refresh();
      } else setDelError(getFormError(r.errors));
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onAnnounce("URL do webhook copiada.");
      toast.success("URL do webhook copiada.");
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Não foi possível copiar. Copie a URL manualmente.");
    }
  }

  return (
    <Card className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="font-heading text-base font-semibold">{cfg.title}</h4>
        <Badge variant={enabled ? "default" : "muted"}>
          {enabled ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <CircleDashed className="size-3.5" aria-hidden="true" />}
          {enabled ? "Ativa" : "Desativada"}
        </Badge>
      </div>

      <dl className="grid gap-1.5 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <dt className="flex items-center gap-1 text-muted-foreground">
            <Webhook className="size-3.5" aria-hidden="true" /> Webhook:
          </dt>
          <dd className="min-w-0 flex-1 break-all font-mono text-xs">{url}</dd>
          <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Copiar URL do webhook">
            {copied ? <CheckCircle2 /> : <Copy />}
          </Button>
        </div>
        {provider === "meta" && (
          <div className="flex flex-wrap gap-1.5">
            <dt className="text-muted-foreground">Ambiente do servidor:</dt>
            <dd className="text-xs">
              App Secret: {flags.metaAppSecret ? "✓" : "✗ ausente"} · Verify token: {flags.metaVerifyToken ? "✓" : "✗ ausente"}
            </dd>
          </div>
        )}
      </dl>

      {!flags.baseUrl && <p className="text-xs text-muted-foreground"><code>APP_BASE_URL</code> não configurada — exibindo apenas o caminho do webhook.</p>}
      {!enabled && (
        <p className="text-xs text-muted-foreground">
          Webhook responde 503 até a variável <code>{cfg.flag}=true</code> ser definida no ambiente do servidor.
        </p>
      )}
      <p className="text-xs text-muted-foreground">{cfg.risk}</p>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h5 className="text-sm font-medium">Vínculos ({bindings.length})</h5>
          <Button size="sm" variant="outline" onClick={() => resetForm(null)} disabled={campaigns.length === 0}>
            <Plus /> Novo vínculo
          </Button>
        </div>
        {bindings.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            Nenhum vínculo ainda: cada identificador abaixo recebe os leads da campanha escolhida.
          </p>
        ) : (
          <ul className="space-y-2">
            {bindings.map((b) => (
              <li key={b.id} className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate font-mono text-sm">{b.externalAccountId}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.label ? `${b.label} · ` : ""}
                    Campanha: {b.campaignName}
                    {b.campaignStatus === "archived" && " (arquivada — leads não são importados)"}
                    {provider === "meta" && <> · Token: {b.tokenHint ? maskHint(b.tokenHint) : "não salvo"}</>}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Editar vínculo ${b.externalAccountId}`} onClick={() => resetForm(b)}>
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remover vínculo ${b.externalAccountId}`}
                    onClick={() => {
                      setDelError(undefined);
                      setConfirmDel(b);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {campaigns.length === 0 ? (
        <p className="text-xs text-muted-foreground">Crie uma campanha antes de cadastrar vínculos.</p>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h5 className="text-sm font-medium">{editing ? `Editar ${editing.externalAccountId}` : `Novo vínculo — ${cfg.idLabel}`}</h5>
            {editing && (
              <Button size="sm" variant="ghost" onClick={() => resetForm(null)}>
                Cancelar edição
              </Button>
            )}
          </div>
          {errors.root?.message && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errors.root.message}
            </p>
          )}
          <Field
            id={`ls-${provider}-key`}
            label={cfg.idLabel}
            required
            error={errors.externalAccountId?.message}
            hint={editing ? "O identificador não muda na edição." : cfg.idHint}
          >
            {(a) => <Input {...a} {...register("externalAccountId")} readOnly={!!editing} autoComplete="off" spellCheck={false} />}
          </Field>
          <Field id={`ls-${provider}-label`} label="Rótulo (opcional)" error={errors.label?.message}>
            {(a) => <Input {...a} {...register("label")} maxLength={80} placeholder="Ex.: Conta de anúncios principal" />}
          </Field>
          <Field id={`ls-${provider}-camp`} label="Campanha" required error={errors.campaignId?.message}>
            {(a) => (
              <select {...a} {...register("campaignId")} className={selectCls}>
                <option value="">Selecione…</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {provider === "meta" && (
            <Field id={`ls-${provider}-token`} label="Page Access Token" required={tokenRequired} error={errors.pageToken?.message} hint={tokenHintText}>
              {(a) => (
                <div className="flex gap-1.5">
                  <Input
                    {...a}
                    {...register("pageToken")}
                    type={reveal ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    placeholder={editing ? "Em branco = manter o atual" : "EAA…"}
                  />
                  <Button variant="outline" size="icon-sm" onClick={() => setReveal((v) => !v)} aria-pressed={reveal} aria-label={reveal ? "Ocultar token" : "Mostrar token"}>
                    {reveal ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
              )}
            </Field>
          )}
          <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {pending ? "Salvando…" : editing ? "Salvar alterações" : "Salvar vínculo"}
          </Button>
        </form>
      )}

      <ConfirmDialog
        open={confirmDel !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDel(null);
        }}
        title={`Remover vínculo ${confirmDel?.externalAccountId ?? ""}?`}
        description={
          provider === "meta"
            ? "O vínculo e o Page Access Token da Página serão apagados. Novos leads dessa Página deixam de ser aceitos e o token não pode ser recuperado."
            : "O vínculo será apagado. Novos leads desse google_key deixam de ser aceitos até que um vínculo seja criado de novo."
        }
        confirmLabel="Remover"
        destructive
        pending={delPending}
        error={delError}
        onConfirm={remove}
      />
    </Card>
  );
}
