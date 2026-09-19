"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { startCampaignSequences } from "@/lib/actions/sequence-start";
import type { StartableLeadsCount } from "@/lib/queries/sequence-start";
import {
  START_CHANNELS_WARNING, formatReasons, startBlockedReason, startResultText, startSummaryText,
} from "@/components/sequences/sequence-start-format";
import { ConfirmDialog } from "./ConfirmDialog";
import { getFormError } from "./form-utils";
import { loadStartableCount } from "./start-actions";

export function CampaignStartSequence({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [count, setCount] = React.useState<StartableLeadsCount | null>(null);
  const [error, setError] = React.useState<string>();
  const [checked, setChecked] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  async function openDialog() {
    setOpen(true);
    setChecked(false);
    setError(undefined);
    setCount(null);
    setLoading(true);
    try {
      const c = await loadStartableCount(campaignId);
      if (c) setCount(c);
      else setError("Campanha não encontrada.");
    } catch {
      setError("Não foi possível carregar os leads pendentes. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  function confirm() {
    setError(undefined);
    startTransition(async () => {
      const r = await startCampaignSequences({ campaignId, confirm: true });
      if (r.ok) {
        toast.success(startResultText(r.data.started, r.data.ineligibleTotal));
        setOpen(false);
        router.refresh();
      } else {
        setError(getFormError(r.errors));
      }
    });
  }

  const blocked = count ? startBlockedReason(count) : null;
  const reasons = count ? formatReasons(count.ineligibleByReason) : [];

  return (
    <>
      <Card className="mx-auto flex max-w-3xl flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-heading text-base font-semibold">Iniciar sequência</h3>
          <p className="text-sm text-muted-foreground">Coloca na fila os leads pendentes desta campanha. Nada é enviado até você confirmar.</p>
        </div>
        <Button onClick={openDialog} className="shrink-0">
          <Play /> Iniciar sequência para os leads pendentes
        </Button>
      </Card>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Iniciar sequência para os leads pendentes?"
        description={`Campanha "${campaignName}".`}
        confirmLabel="Iniciar sequência"
        pending={pending}
        error={error}
        confirmDisabled={loading || !count || blocked !== null || !checked}
        onConfirm={confirm}
      >
        <div aria-live="polite" className="space-y-3 text-sm">
          {loading && <p className="text-muted-foreground">Verificando leads pendentes…</p>}
          {count && (
            <>
              <p className="font-medium">{startSummaryText(count.eligible, count.ineligible)}</p>
              {reasons.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              {blocked && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
                  {blocked}
                </p>
              )}
            </>
          )}
        </div>
        <p className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {START_CHANNELS_WARNING}
        </p>
        <label className="flex min-h-11 items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            disabled={!count || blocked !== null}
            className="mt-0.5 size-4 accent-[var(--color-primary)]"
          />
          <span>Entendo e confirmo o início da sequência para esses leads.</span>
        </label>
      </ConfirmDialog>
    </>
  );
}
