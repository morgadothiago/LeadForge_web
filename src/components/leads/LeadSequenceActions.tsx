"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pause, Play } from "lucide-react";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { startSequence, stopSequence } from "@/lib/actions/sequence-start";
import { START_CHANNELS_WARNING, leadSequenceAction, type SequenceStatusKey } from "@/components/sequences/sequence-start-format";

export function LeadSequenceActions({ leadId, leadName, status }: { leadId: string; leadName: string; status: SequenceStatusKey }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  const action = leadSequenceAction(status);
  if (!action) return null;
  const isStart = action === "start";

  function run() {
    setError(undefined);
    startTransition(async () => {
      const r = isStart ? await startSequence({ leadId }) : await stopSequence({ leadId });
      if (r.ok) {
        toast.success(isStart ? "Sequência iniciada. O envio segue os limites e janelas dos canais." : "Sequência pausada.");
        setOpen(false);
        router.refresh();
      } else {
        setError(r.errors._form?.[0] ?? r.errors.leadId?.[0] ?? Object.values(r.errors).flat()[0] ?? "Não foi possível concluir a operação.");
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => { setError(undefined); setOpen(true); }}>
        {isStart ? <Play /> : <Pause />} {isStart ? "Iniciar sequência" : "Pausar sequência"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={isStart ? `Iniciar sequência de ${leadName}?` : `Pausar sequência de ${leadName}?`}
        description={
          isStart
            ? START_CHANNELS_WARNING
            : "Os próximos contatos agendados serão cancelados e nenhuma mensagem será enviada até você reiniciar a sequência."
        }
        confirmLabel={isStart ? "Iniciar sequência" : "Pausar sequência"}
        pending={pending}
        error={error}
        onConfirm={run}
      />
    </>
  );
}
