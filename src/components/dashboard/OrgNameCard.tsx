"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { notifyActionError } from "@/components/feedback/notify";
import { renameOrganization } from "@/lib/actions/billing";
import { renameOrgSchema, type RenameOrgInput } from "@/lib/schemas/billing";
import { dismissOnboardingCard } from "@/lib/onboarding-state";

/**
 * SPEC-065b (D-065-22) — cartao dispensavel "Como se chama a sua empresa?" do primeiro acesso ao dashboard. A organizacao nasce como
 * "Empresa de {primeiro nome}"; aqui o dono troca por `renameOrganization` (RHF + `renameOrgSchema`). "Agora nao" dispensa (cookie
 * por organizacao); o nome tambem pode ser mudado depois. So aparece para o proprietario (a barreira real e `requireOwner` na action).
 */
export function OrgNameCard({ orgId, currentName }: { orgId: string; currentName: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [hidden, setHidden] = React.useState(false);
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<RenameOrgInput>({ resolver: zodResolver(renameOrgSchema), defaultValues: { name: currentName } });

  if (hidden) return null;

  const dismiss = () => {
    dismissOnboardingCard("name", orgId);
    setHidden(true);
  };

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const res = await renameOrganization(values);
      if (!res.ok) {
        const msg = res.errors.name?.join(" ");
        if (msg) {
          setError("name", { type: "server", message: msg });
          setFocus("name");
        }
        notifyActionError(res.errors);
        return;
      }
      toast.success("Nome da empresa atualizado.");
      dismissOnboardingCard("name", orgId);
      setHidden(true);
      router.refresh();
    });
  });

  return (
    <Card role="region" aria-labelledby="org-name-card-title" className="relative border-primary/30 p-4 sm:p-5">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dispensar: perguntar o nome da empresa mais tarde"
        className="absolute right-2 top-2 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 pr-8 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 hidden size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:flex">
            <Building2 className="size-5" />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <h2 id="org-name-card-title" className="font-heading text-base font-semibold">
              Como se chama a sua empresa?
            </h2>
            <p className="text-sm text-muted-foreground">Esse nome aparece para a sua equipe. Dá para mudar depois.</p>
            <Field id="org-name" label="Nome da empresa" error={errors.name?.message}>
              {(a) => <Input {...a} {...register("name")} defaultValue={currentName} type="text" autoComplete="organization" maxLength={120} className="max-w-md" />}
            </Field>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={pending} aria-busy={pending} className="min-h-11 sm:min-h-9">
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {pending ? "Salvando..." : "Salvar nome"}
          </Button>
          <Button type="button" variant="ghost" onClick={dismiss} disabled={pending} className="min-h-11 sm:min-h-9">
            Agora não
          </Button>
        </div>
      </form>
    </Card>
  );
}
