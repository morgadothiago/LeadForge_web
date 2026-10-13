"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { notifyActionError } from "@/components/feedback/notify";
import { isPlanOrPolicyError } from "@/components/feedback/action-errors";
import { Loader2, Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSearchRunStatus, searchLeads, type SearchRunStatus } from "@/lib/actions/lead-search";
import type { LeadSearchPanel } from "@/lib/queries/lead-search";
import { ConfirmDialog } from "./ConfirmDialog";
import { getFormError } from "./form-utils";
import {
  BACKGROUND_TEXT, DUPLICATES_HINT, NEXT_PAGE_HINT, POLL_INTERVAL_MS, UI_MAX_WAIT_MS,
  confirmCostText, deriveBlock, estimateText, resultText, type Counts,
} from "./lead-search-format";

const STATUS: Record<string, string> = { running: "Em andamento", done: "Concluída", completed: "Concluída", failed: "Falhou", error: "Falhou", blocked: "Bloqueada" };
const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

type Outcome = { kind: "done"; counts: Counts } | { kind: "failed"; message: string };

function toOutcome(s: Pick<SearchRunStatus, "status" | "error"> & Counts): Outcome {
  if (s.status === "done" || s.status === "completed") return { kind: "done", counts: s };
  return { kind: "failed", message: s.error || "A busca falhou. Tente novamente mais tarde." };
}

export function CampaignLeadSearch({ campaignId, campaignName, campaignActive, panel }: {
  campaignId: string; campaignName: string; campaignActive: boolean; panel: LeadSearchPanel;
}) {
  const router = useRouter();
  const activeRun = panel.canManage ? panel.activeRun : null;
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [outcome, setOutcome] = React.useState<Outcome>();
  const [runId, setRunId] = React.useState<string | null>(activeRun?.id ?? null);
  const [startedAt, setStartedAt] = React.useState<number>(activeRun ? new Date(activeRun.startedAt).getTime() : 0);
  const [timedOut, setTimedOut] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  // RSC trouxe um run ativo novo (ex.: outra aba/refresh): entra no estado rodando (ajuste de estado durante o render).
  const activeId = activeRun?.id ?? null;
  const [seenActive, setSeenActive] = React.useState(activeId);
  if (activeId !== seenActive) {
    setSeenActive(activeId);
    if (activeId && activeRun && !runId) {
      setRunId(activeId);
      setStartedAt(new Date(activeRun.startedAt).getTime());
    }
  }

  // Polling a cada 3 s; a UI desiste após 2 min (o run segue no servidor).
  React.useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const tick = async () => {
      if (Date.now() - startedAt >= UI_MAX_WAIT_MS) {
        setTimedOut(true);
        setRunId(null);
        return;
      }
      const r = await getSearchRunStatus(runId);
      if (cancelled || !r.ok || r.data.status === "running") return;
      const o = toOutcome(r.data);
      setOutcome(o);
      setRunId(null);
      if (o.kind === "done") toast.success(`Busca concluída: ${resultText(o.counts)}.`);
      router.refresh();
    };
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [runId, startedAt, router]);

  if (!panel.canManage) {
    return (
      <Card className="mx-auto max-w-3xl p-5">
        <h3 className="font-heading text-base font-semibold">Buscar leads</h3>
        <p className="mt-1 text-sm text-muted-foreground">Somente administradores podem buscar leads automaticamente.</p>
      </Card>
    );
  }

  const running = runId !== null;
  const block = deriveBlock(panel, campaignActive);
  const disabled = block !== null || running || pending;

  function confirm() {
    setError(undefined);
    setOutcome(undefined);
    setTimedOut(false);
    startTransition(async () => {
      const r = await searchLeads(campaignId);
      if (!r.ok) {
        // SPEC-069d: limite de buscas do plano / recurso bloqueado => toast com a explicacao e "Fazer upgrade".
        if (isPlanOrPolicyError(r.errors)) {
          setOpen(false);
          notifyActionError(r.errors);
          return;
        }
        setError(getFormError(r.errors));
        return;
      }
      setOpen(false);
      if (r.data.status === "running") {
        setStartedAt(Date.now());
        setRunId(r.data.runId);
        return;
      }
      setOutcome({ kind: "done", counts: r.data });
      toast.success(`Busca concluída: ${resultText(r.data)}.`);
      router.refresh();
    });
  }

  return (
    <>
      <Card className="mx-auto max-w-3xl space-y-4 p-5" aria-busy={running}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="font-heading text-base font-semibold">Buscar leads</h3>
            <p className="text-sm text-muted-foreground">
              Busca empresas pelo ICP da campanha (até {panel.maxResults} resultados por busca).
            </p>
          </div>
          <Button onClick={() => { setError(undefined); setOpen(true); }} disabled={disabled} className="w-full shrink-0 sm:w-auto">
            {running ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />} {panel.hasNextPage ? "Buscar mais resultados" : "Buscar agora"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">{estimateText(panel)}</p>
        <p className="text-xs text-muted-foreground">{panel.hasNextPage ? NEXT_PAGE_HINT : DUPLICATES_HINT}</p>

        {block && (
          <p role="status" className="flex flex-wrap items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {block.message}{" "}
              {block.kind === "nokey" && (
                <Link href="/configuracoes/integracoes" className="font-medium underline underline-offset-2">Ir para Integrações</Link>
              )}
            </span>
          </p>
        )}

        {running && (
          <p role="status" aria-live="polite" className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
            <span>Buscando leads… isso pode levar até um minuto.</span>
          </p>
        )}

        {timedOut && !running && (
          <p role="status" aria-live="polite" className="rounded-md bg-muted px-3 py-2 text-sm">{BACKGROUND_TEXT}</p>
        )}

        {outcome?.kind === "done" && (
          <p role="status" aria-live="polite" className="rounded-md bg-muted px-3 py-2 text-sm">Busca concluída: {resultText(outcome.counts)}.</p>
        )}
        {outcome?.kind === "failed" && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">Busca falhou: {outcome.message}</p>
        )}

        <div>
          <h4 className="mb-2 text-sm font-medium">Histórico (últimas 10 buscas)</h4>
          {panel.runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma busca realizada ainda.</p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {panel.runs.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex flex-wrap items-center gap-2">
                    <time dateTime={new Date(r.startedAt).toISOString()}>{fmt.format(new Date(r.startedAt))}</time>
                    <Badge variant={r.status === "failed" || r.status === "error" ? "destructive" : "muted"}>{STATUS[r.status] ?? r.status}</Badge>
                    <Badge variant="muted">{r.trigger === "scheduled" ? "Agendada" : "Manual"}</Badge>
                  </span>
                  <span className="text-muted-foreground sm:text-right">
                    {r.found} encontrados · {resultText(r)}
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
        title={panel.hasNextPage ? "Buscar mais resultados?" : "Buscar novos leads?"}
        description={`Campanha "${campaignName}".`}
        confirmLabel={panel.hasNextPage ? "Buscar mais resultados" : "Buscar agora"}
        pending={pending}
        error={error}
        onConfirm={confirm}
      >
        <div className="space-y-2 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{confirmCostText(panel)}</p>
          <p>Os leads entram como novos; nada é enviado automaticamente.</p>
          <p>{panel.hasNextPage ? NEXT_PAGE_HINT : DUPLICATES_HINT}</p>
        </div>
      </ConfirmDialog>
    </>
  );
}
