"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { applyServerErrors } from "@/components/org/org-format";
import { saveIntegration } from "@/lib/actions/integration";
import { saveIntegrationSchema } from "@/lib/schemas/integration";
import type { IntegrationItemView, IntegrationSummary } from "@/lib/integrations/view";
import { validateBaseUrl } from "./integration-format";

interface Props {
  summary: IntegrationSummary;
  item?: IntegrationItemView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAnnounce?: (m: string) => void;
}

export function IntegrationFormDialog({ summary, item, open, onOpenChange, onAnnounce }: Props) {
  const editing = Boolean(item);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? `Editar ${summary.label}` : `Configurar ${summary.label}`}
          </DialogTitle>
          <DialogDescription>
            {editing ? "Atualize a URL ou troque a chave. Deixe a chave em branco para manter a atual." : "Informe os dados de acesso. A chave é guardada cifrada no banco."}
          </DialogDescription>
        </DialogHeader>
        {/* Desmontado ao fechar: o valor digitado nunca sobrevive ao diálogo. */}
        <IntegrationForm summary={summary} item={item} onDone={() => onOpenChange(false)} onAnnounce={onAnnounce} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Estado do formulário RHF (SPEC-045). Os nomes de `value`/`baseUrl`/`allowPrivateHost` coincidem com os paths do
 * `saveIntegrationSchema`, então erro de servidor (`ActionResult.errors`) cai direto no campo certo.
 */
interface IntegrationFormState {
  value: string;
  baseUrl: string;
  allowPrivateHost: boolean;
}

const INTEGRATION_FIELDS = ["value", "baseUrl", "allowPrivateHost"] as const;

function IntegrationForm({ summary, item, onDone, onAnnounce }: { summary: IntegrationSummary; item?: IntegrationItemView; onDone: () => void; onAnnounce?: (m: string) => void }) {
  const router = useRouter();
  const uid = React.useId();
  const [pending, startTransition] = React.useTransition();
  const [showSecret, setShowSecret] = React.useState(false);
  const editing = Boolean(item);
  // SPEC-036: LLM aceita URL base opcional (OpenAI-compatível: Ollama/Gemini/Groq); com URL a chave é opcional.
  const isLlm = summary.integration === "llm";
  const showUrl = summary.requiresBaseUrl || isLlm;
  const requiresBaseUrl = summary.requiresBaseUrl;
  const integration = summary.integration;
  const itemName = item?.name ?? "default";

  // Mesmas checagens locais de antes ("Informe a chave.", `validateBaseUrl`); passando nelas, o schema do servidor
  // (`saveIntegrationSchema`, fonte única) valida o mesmo payload que a action recebe.
  const resolver = React.useMemo(
    () =>
      zodResolver(
        z.preprocess((v: IntegrationFormState, ctx) => {
          const keyOptional = editing || (isLlm && v.baseUrl.trim() !== "");
          const withUrl = showUrl && (requiresBaseUrl || v.baseUrl.trim() !== "");
          if (!keyOptional && !v.value.trim()) ctx.addIssue({ code: "custom", path: ["value"], message: "Informe a chave." });
          if (withUrl) {
            const m = validateBaseUrl(v.baseUrl, true);
            if (m) ctx.addIssue({ code: "custom", path: ["baseUrl"], message: m });
          }
          return {
            integration,
            name: itemName,
            ...(v.value ? { value: v.value } : {}),
            ...(withUrl ? { baseUrl: v.baseUrl.trim(), allowPrivateHost: v.allowPrivateHost } : {}),
          };
        }, saveIntegrationSchema),
      ),
    [editing, isLlm, showUrl, requiresBaseUrl, integration, itemName],
  );

  const { register, handleSubmit, watch, setValue, setError, setFocus, getValues, formState } = useForm<IntegrationFormState, unknown, z.output<typeof saveIntegrationSchema>>({
    resolver,
    defaultValues: { value: "", baseUrl: item?.baseUrl ?? "", allowPrivateHost: item?.allowPrivateHost ?? false },
  });
  const { errors } = formState;
  const baseUrl = watch("baseUrl");
  const keyOptional = editing || (isLlm && baseUrl.trim() !== "");

  const onSubmit = handleSubmit(() => {
    const v = getValues();
    startTransition(async () => {
      // Payload cru (a action revalida com o mesmo schema). O valor da chave só existe no input; limpo ao salvar.
      const r = await saveIntegration({
        integration: summary.integration,
        name: item?.name ?? "default",
        ...(v.value ? { value: v.value } : {}),
        ...(showUrl && (summary.requiresBaseUrl || v.baseUrl.trim()) ? { baseUrl: v.baseUrl.trim(), allowPrivateHost: v.allowPrivateHost } : {}),
      });
      if (r.ok) {
        setValue("value", "");
        const msg = `${summary.label}: configuração salva.`;
        toast.success(msg);
        onAnnounce?.(msg);
        onDone();
        router.refresh();
        return;
      }
      toast.error(applyServerErrors(r.errors, setError, setFocus, INTEGRATION_FIELDS));
    });
  });

  const testHint = summary.testAvailable ? null : "O teste real de conexão ainda não está disponível para esta integração (depende do cliente correspondente).";

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate autoComplete="off">
      {errors.root?.message && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      {showUrl && (
        <Field id={`${uid}-url`} label="URL base" required={!isLlm} error={errors.baseUrl?.message} hint={isLlm ? "Opcional. Vazio = Claude (Anthropic). Ex.: http://localhost:11434/v1 (Ollama), https://generativelanguage.googleapis.com/v1beta/openai (Gemini), https://api.groq.com/openai/v1 (Groq)" : "Endereço do servidor, ex.: https://evolution.exemplo.com"}>
          {(a) => <Input {...a} {...register("baseUrl")} type="url" inputMode="url" maxLength={300} autoComplete="off" />}
        </Field>
      )}
      <Field
        id={`${uid}-key`}
        label={editing ? "Nova chave (opcional)" : "Chave de API"}
        required={!keyOptional}
        error={errors.value?.message}
        hint={
          editing
            ? `Deixe vazio para manter a chave atual (${item?.hintDisplay ?? "••••"}). Preencha só para trocar.`
            : isLlm && keyOptional
              ? "Opcional com URL base (Ollama não usa chave). 12 a 512 caracteres, sem espaços."
              : "12 a 512 caracteres, sem espaços."
        }
      >
        {(a) => (
          <div className="flex gap-2">
            <Input
              {...a}
              {...register("value")}
              type={showSecret ? "text" : "password"}
              autoComplete="new-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={512}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label={showSecret ? "Ocultar chave" : "Mostrar chave"}
              aria-pressed={showSecret}
              onClick={() => setShowSecret((v) => !v)}
            >
              {showSecret ? <EyeOff /> : <Eye />}
            </Button>
          </div>
        )}
      </Field>
      <p className="-mt-2 text-xs text-muted-foreground">A chave não pode ser recuperada depois de salva: guarde-a também no seu gerenciador de segredos.</p>

      {isLlm && baseUrl.trim() !== "" && (
        <p role="note" className="rounded-md border border-warning/50 bg-warning/10 p-3 text-xs text-muted-foreground">
          Privacidade (LGPD): com provedor externo (Gemini, Groq, OpenRouter) os dados dos leads (nome, empresa, histórico mínimo) saem do seu computador, e o free tier do Google pode usar o conteúdo para melhoria de produto. Com Ollama local nada sai da sua máquina. Ao trocar a URL sem informar nova chave, a chave anterior é removida.
        </p>
      )}
      {showUrl && (
        <div className="rounded-md border border-warning/50 bg-warning/10 p-3">
          <label htmlFor={`${uid}-priv`} className="flex cursor-pointer items-start gap-2.5 text-sm font-medium">
            <input
              id={`${uid}-priv`}
              type="checkbox"
              {...register("allowPrivateHost")}
              aria-describedby={`${uid}-priv-d`}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            Esta é uma instância própria (localhost/rede privada)
          </label>
          <p id={`${uid}-priv-d`} className="mt-1.5 flex gap-1.5 text-xs text-muted-foreground">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
            <span>
              Marque somente se o servidor for seu (ex.: Docker local ou rede interna). Liberar endereços privados permite que o app acesse sua rede interna. Endereços de
              metadados de nuvem (169.254.x.x etc.) continuam sempre bloqueados. Esta escolha fica registrada na auditoria.
            </span>
          </p>
        </div>
      )}
      {testHint && <p className="text-xs text-muted-foreground">{testHint}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
