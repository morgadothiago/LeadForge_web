"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Pencil, ShieldOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { LostReasonDialog } from "@/components/pipeline/LostReasonDialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { deleteLead, moveLeadStage } from "@/lib/actions/lead";
import { addToSuppression } from "@/lib/actions/suppression";
import { STAGES, STAGE_LABELS, type StageKey } from "@/lib/domain";
import { LeadFormDialog, type LeadFormValues } from "./LeadFormDialog";

export function LeadActions({ lead, stage, suppressed = false }: { lead: LeadFormValues; stage: StageKey | null; suppressed?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [confirmDel, setConfirmDel] = React.useState(false);
  const [delError, setDelError] = React.useState<string | undefined>();
  const [confirmSup, setConfirmSup] = React.useState(false);
  const [supError, setSupError] = React.useState<string | undefined>();
  const [lossPending, setLossPending] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function move(toStage: StageKey, lostReason?: string | null) {
    startTransition(async () => {
      const r = await moveLeadStage({ leadId: lead.id, toStage, ...(toStage === "perdido" ? { lostReason: lostReason ?? null } : {}) });
      if (r.ok) {
        toast.success(`Movido para ${STAGE_LABELS[toStage]}.`);
        if (toStage === "fechado" || toStage === "perdido") toast.info("Sequência automática encerrada.");
        router.refresh();
      } else {
        toast.error(r.errors._form?.[0] ?? Object.values(r.errors)[0]?.[0] ?? "Não foi possível mover o lead.");
      }
    });
  }

  function suppress() {
    setSupError(undefined);
    startTransition(async () => {
      const r = await addToSuppression({ leadId: lead.id });
      if (r.ok) {
        toast.success("Lead adicionado à lista de supressão. Nenhuma mensagem será enviada.");
        setConfirmSup(false);
        router.refresh();
      } else {
        setSupError(r.errors._form?.[0] ?? Object.values(r.errors)[0]?.[0] ?? "Não foi possível adicionar à supressão.");
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const r = await deleteLead(lead.id);
      if (r.ok) {
        toast.success("Lead excluído.");
        router.push("/leads");
      } else {
        setDelError(r.errors._form?.[0] ?? Object.values(r.errors)[0]?.[0] ?? "Não foi possível excluir o lead.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {stage && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" disabled={pending} />}>
            <ArrowRightLeft /> Mover etapa
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <p className="px-2 py-1 text-xs text-muted-foreground">Mover para…</p>
            {STAGES.filter((s) => s !== stage).map((s) => (
              <DropdownMenuItem key={s} onClick={() => (s === "perdido" ? setLossPending(true) : move(s))}>
                {STAGE_LABELS[s]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button variant="outline" onClick={() => setEditing(true)}>
        <Pencil /> Editar
      </Button>
      {!suppressed && (
        <Button variant="outline" onClick={() => { setSupError(undefined); setConfirmSup(true); }}>
          <ShieldOff /> Adicionar à supressão
        </Button>
      )}
      <Button
        variant="outline"
        onClick={() => {
          setDelError(undefined);
          setConfirmDel(true);
        }}
        className="text-destructive"
      >
        <Trash2 /> Excluir
      </Button>

      <LeadFormDialog mode="edit" lead={lead} open={editing} onOpenChange={setEditing} />
      {lossPending && (
        <LostReasonDialog
          leadName={lead.name}
          onCancel={() => setLossPending(false)}
          onConfirm={(reason) => {
            setLossPending(false);
            move("perdido", reason);
          }}
        />
      )}
      <ConfirmDialog
        open={confirmSup}
        onOpenChange={setConfirmSup}
        title={`Adicionar ${lead.name} à supressão?`}
        description="O e-mail e o telefone do lead entram na lista de supressão global: ele não receberá mais mensagens em nenhum canal ou campanha, a sequência é encerrada e os toques pendentes são cancelados. Use quando o contato pediu para não ser contatado."
        confirmLabel="Adicionar à supressão"
        destructive
        pending={pending}
        error={supError}
        onConfirm={suppress}
      />
      <ConfirmDialog
        open={confirmDel}
        onOpenChange={setConfirmDel}
        title={`Excluir ${lead.name}?`}
        description="A exclusão é permanente e só é possível para leads sem histórico de contato. Se o lead já foi contatado, mova-o para Perdido."
        confirmLabel="Excluir lead"
        destructive
        pending={pending}
        error={delError}
        onConfirm={remove}
      />
    </div>
  );
}
