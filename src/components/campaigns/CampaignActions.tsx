"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Copy, MoreHorizontal, Pause, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  archiveCampaign,
  deleteCampaign,
  duplicateCampaign,
  pauseCampaign,
  resumeCampaign,
} from "@/lib/actions/campaign";
import type { ActionResult } from "@/lib/actions/result";
import type { CampaignStatus } from "@prisma/client";
import { ConfirmDialog } from "./ConfirmDialog";

type Confirm = "archive" | "delete" | null;

const firstError = (r: { ok: false; errors: Record<string, string[]> }): string =>
  Object.values(r.errors).flat()[0] ?? "Não foi possível concluir a ação.";

export function CampaignActions({
  campaign,
  afterDeleteHref,
}: {
  campaign: { id: string; name: string; status: CampaignStatus; leadCount: number };
  /** para onde ir após excluir (detalhe → lista) */
  afterDeleteHref?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const [error, setError] = React.useState<string>();

  function run<T>(fn: () => Promise<ActionResult<T>>, success: string, after?: (d: T) => void) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(success);
        setConfirm(null);
        setError(undefined);
        after?.(r.data);
        router.refresh();
      } else if (confirm) {
        setError(firstError(r));
      } else {
        toast.error(firstError(r));
      }
    });
  }

  const { id, status } = campaign;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" aria-label={`Ações da campanha ${campaign.name}`} disabled={pending} />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {status === "active" && (
            <DropdownMenuItem onClick={() => run(() => pauseCampaign(id), "Campanha pausada.")}>
              <Pause className="size-4" /> Pausar
            </DropdownMenuItem>
          )}
          {status !== "active" && (
            <DropdownMenuItem onClick={() => run(() => resumeCampaign(id), status === "archived" ? "Campanha reativada." : "Campanha retomada.")}>
              <Play className="size-4" /> {status === "archived" ? "Reativar" : "Retomar"}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() =>
              run(() => duplicateCampaign(id), "Campanha duplicada (pausada).", (d) => router.push(`/campanhas/${d.id}`))
            }
          >
            <Copy className="size-4" /> Duplicar
          </DropdownMenuItem>
          {status !== "archived" && (
            <DropdownMenuItem onClick={() => { setError(undefined); setConfirm("archive"); }}>
              <Archive className="size-4" /> Arquivar
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={() => { setError(undefined); setConfirm("delete"); }}>
            <Trash2 className="size-4" /> Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirm === "archive"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Arquivar campanha?"
        description={`"${campaign.name}" deixa de aparecer na lista principal e para de prospectar. Os leads são mantidos.`}
        confirmLabel="Arquivar"
        pending={pending}
        error={error}
        onConfirm={() => run(() => archiveCampaign(id), "Campanha arquivada.")}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Excluir campanha?"
        description={
          campaign.leadCount > 0
            ? `"${campaign.name}" possui ${campaign.leadCount} lead(s) e não pode ser excluída. Arquive-a em vez disso.`
            : `"${campaign.name}" será excluída permanentemente. Esta ação não pode ser desfeita.`
        }
        confirmLabel="Excluir"
        destructive
        pending={pending}
        error={error}
        onConfirm={() =>
          run(() => deleteCampaign(id), "Campanha excluída.", () => afterDeleteHref && router.push(afterDeleteHref))
        }
      />
    </>
  );
}
