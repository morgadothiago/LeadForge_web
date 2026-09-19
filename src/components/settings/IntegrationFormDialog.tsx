"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { fieldError, getFormError } from "@/components/campaigns/form-utils";
import { saveIntegration } from "@/lib/actions/integration";
import type { FieldErrors } from "@/lib/actions/result";
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

function IntegrationForm({ summary, item, onDone, onAnnounce }: { summary: IntegrationSummary; item?: IntegrationItemView; onDone: () => void; onAnnounce?: (m: string) => void }) {
  const router = useRouter();
  const uid = React.useId();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [pending, startTransition] = React.useTransition();
  // Único lugar onde o valor da chave existe: input controlado, limpo ao salvar/fechar.
  const [secret, setSecret] = React.useState("");
  const [showSecret, setShowSecret] = React.useState(false);
  const [baseUrl, setBaseUrl] = React.useState(item?.baseUrl ?? "");
  const [priv, setPriv] = React.useState(item?.allowPrivateHost ?? false);
  const [errors, setErrors] = React.useState<FieldErrors | undefined>();
  const [errorTick, setErrorTick] = React.useState(0);
  const editing = Boolean(item);

  React.useEffect(() => {
    if (!errorTick) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errorTick]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const local: FieldErrors = {};
    if (!editing && !secret.trim()) local.value = ["Informe a chave."];
    if (summary.requiresBaseUrl) {
      const m = validateBaseUrl(baseUrl, true);
      if (m) local.baseUrl = [m];
    }
    if (Object.keys(local).length) {
      setErrors(local);
      setErrorTick((t) => t + 1);
      return;
    }
    setErrors(undefined);
    startTransition(async () => {
      const r = await saveIntegration({
        integration: summary.integration,
        name: item?.name ?? "default",
        ...(secret ? { value: secret } : {}),
        ...(summary.requiresBaseUrl ? { baseUrl: baseUrl.trim(), allowPrivateHost: priv } : {}),
      });
      if (r.ok) {
        setSecret("");
        const msg = `${summary.label}: configuração salva.`;
        toast.success(msg);
        onAnnounce?.(msg);
        onDone();
        router.refresh();
      } else {
        setErrors(r.errors);
        setErrorTick((t) => t + 1);
      }
    });
  }

  const formError = errors?._form ? getFormError({ _form: errors._form }) : undefined;
  const testHint = summary.testAvailable ? null : "O teste real de conexão ainda não está disponível para esta integração (depende do cliente correspondente).";

  return (
    <form ref={formRef} onSubmit={submit} className="grid gap-4" noValidate autoComplete="off">
      {formError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}
      {summary.requiresBaseUrl && (
        <Field id={`${uid}-url`} label="URL base" required error={fieldError(errors, "baseUrl")} hint="Endereço do servidor, ex.: https://evolution.exemplo.com">
          {(a) => <Input {...a} name="baseUrl" type="url" inputMode="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} maxLength={300} autoComplete="off" />}
        </Field>
      )}
      <Field
        id={`${uid}-key`}
        label={editing ? "Nova chave (opcional)" : "Chave de API"}
        required={!editing}
        error={fieldError(errors, "value")}
        hint={
          editing
            ? `Deixe vazio para manter a chave atual (${item?.hintDisplay ?? "••••"}). Preencha só para trocar.`
            : "8 a 512 caracteres, sem espaços."
        }
      >
        {(a) => (
          <div className="flex gap-2">
            <Input
              {...a}
              name="secret"
              type={showSecret ? "text" : "password"}
              autoComplete="new-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
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

      {summary.requiresBaseUrl && (
        <div className="rounded-md border border-warning/50 bg-warning/10 p-3">
          <label htmlFor={`${uid}-priv`} className="flex cursor-pointer items-start gap-2.5 text-sm font-medium">
            <input
              id={`${uid}-priv`}
              type="checkbox"
              checked={priv}
              onChange={(e) => setPriv(e.target.checked)}
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
