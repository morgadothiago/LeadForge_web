"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { searchLeads, type LeadSearchResult } from "@/lib/actions/lead-search";
import type { LeadSearchPanel } from "@/lib/queries/lead-search";
import { ConfirmDialog } from "./ConfirmDialog";
import { getFormError } from "./form-utils";

const STATUS: Record<string, string> = { running: "Em andamento", done: "Concluída", completed: "Concluída", failed: "Falhou", error: "Falhou", blocked: "Bloqueada" };
const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function CampaignLeadSearch({ campaignId, campaignName, campaignActive, panel }: {
  campaignId: string; campaignName: string; campaignActive: boolean; panel: LeadSearchPanel;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [result, setResult] = React.useState<LeadSearchResult>();
  const [pending, startTransition] = React.useTransition();

  if (!panel.canManage) {
    return (
      <Card className="mx-auto max-w-3xl p-5">
        <h3 className="font-heading text-base font-semibold">Buscar leads</h3>
        <p className="mt-1 text-sm text-muted-foreground">Somente administradores podem buscar leads automaticamente.</p>
      </Card>
    );
  }

  const configIssue = !panel.enabled
    ? "A busca de leads está desativada no servidor (LEAD_SEARCH_ENABLED)."
    : !panel.hasKey
      ? "Falta a chave de Busca de leads (Places)."
      : null;
  const budgetOut = panel.usedToday >= panel.budget;
  const blocked = configIssue ?? (!campaignActive ? "A campanha precisa estar ativa para buscar leads." : budgetOut ? "Limite diário de buscas desta campanha atingido. Tente amanhã." : null);

  function confirm() {
    setError(undefined);
    startTransition(async () => {
      const r = await searchLeads(campaignId);
      if (r.ok) {
        setResult(r.data);
        setOpen(false);
        toast.success(`Busca concluída: ${r.data.created} novo${r.data.created === 1 ? "" : "s"} lead${r.data.created === 1 ? "" : "s"}.`);
        router.refresh();
      } else {
        setError(getFormError(r.errors));
      }
    });
  }

  return (
    <>
      <Card className="mx-auto max-w-3xl space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="font-heading text-base font-semibold">Buscar leads</h3>
            <p className="text-sm text-muted-foreground">
              Busca empresas pelo ICP da campanha (até {panel.maxResults} por execução). {panel.usedToday}/{panel.budget} buscas hoje.
            </p>
          </div>
          <Button onClick={() => { setError(undefined); setOpen(true); }} disabled={blocked !== null} className="shrink-0">
            <Search /> Buscar leads
          </Button>
        </div>

        {blocked && (
          <p role="status" className="flex flex-wrap items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {blocked}{" "}
              {configIssue && (
                <Link href="/configuracoes/integracoes" className="font-medium underline underline-offset-2">Ir para Integrações</Link>
              )}
            </span>
          </p>
        )}

        {result && (
          <p role="status" aria-live="polite" className="rounded-md bg-muted px-3 py-2 text-sm">
            Última busca: {result.found} encontrado{result.found === 1 ? "" : "s"}, {result.created} novo{result.created === 1 ? "" : "s"},{" "}
            {result.duplicate} duplicado{result.duplicate === 1 ? "" : "s"}, {result.suppressed} suprimido{result.suppressed === 1 ? "" : "s"}.
          </p>
        )}

        <div>
          <h4 className="mb-2 text-sm font-medium">Histórico</h4>
          {panel.runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma busca realizada ainda.</p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {panel.runs.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex flex-wrap items-center gap-2">
                    <time dateTime={r.startedAt.toISOString()}>{fmt.format(r.startedAt)}</time>
                    <Badge variant={r.status === "failed" || r.status === "error" ? "destructive" : "muted"}>{STATUS[r.status] ?? r.status}</Badge>
                    <Badge variant="muted">{r.trigger === "scheduled" ? "Agendada" : "Manual"}</Badge>
                  </span>
                  <span className="text-muted-foreground">
                    {r.found} encontrados · {r.created} novos · {r.duplicate} duplicados · {r.suppressed} suprimidos
                    {r.error ? ` · ${r.error}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Buscar novos leads?"
        description={`Campanha "${campaignName}".`}
        confirmLabel="Buscar leads"
        pending={pending}
        error={error}
        onConfirm={confirm}
      >
        <p className="text-sm text-muted-foreground">
          Consulta a fonte externa (uso pago, limite de {panel.budget} buscas por dia). Os leads entram como novos; nada é enviado automaticamente.
        </p>
      </ConfirmDialog>
    </>
  );
}
