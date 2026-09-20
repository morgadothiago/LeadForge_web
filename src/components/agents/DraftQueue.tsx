"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { approveDraft, bulkApproveFollowups, rejectDraftAction, takeOverLead } from "@/lib/actions/agent";
import { getFormError } from "@/components/campaigns/form-utils";
import { ROLE_LABELS } from "./agent-format";

export interface DraftView { id: string; body: string; channel: string; leadName: string; company: string | null; agentName: string; role: keyof typeof ROLE_LABELS; createdAt: string }
export interface NeedsHumanView { id: string; name: string; company: string | null; reason: string | null }

export function DraftQueue({ drafts, needsHuman }: { drafts: DraftView[]; needsHuman: NeedsHumanView[] }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const followups = drafts.filter((d) => d.role === "followup");
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function bulk() {
    start(async () => {
      const r = await bulkApproveFollowups({ ids: [...selected] });
      if (r.ok) { toast.success(`${r.data.sent} enviado(s), ${r.data.blocked} bloqueado(s) pela política de envio.`); setSelected(new Set()); router.refresh(); } else toast.error(getFormError(r.errors));
    });
  }
  return (
    <div className="space-y-8">
      <section aria-labelledby="nh-h" className="space-y-3">
        <h3 id="nh-h" className="font-heading text-base font-semibold">Precisa de você ({needsHuman.length})</h3>
        {needsHuman.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum lead aguardando atendimento humano.</p> : (
          <ul className="grid gap-2 md:grid-cols-2">
            {needsHuman.map((l) => (
              <Card key={l.id} className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{l.name}{l.company ? ` · ${l.company}` : ""}</p><p className="truncate text-xs text-muted-foreground">Motivo: {l.reason ?? "não informado"}</p></div>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { const r = await takeOverLead({ id: l.id }); if (r.ok) { toast.success("Você assumiu a conversa."); router.refresh(); } else toast.error(getFormError(r.errors)); })}>Assumir</Button>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="dq-h" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="dq-h" className="font-heading text-base font-semibold">Rascunhos pendentes ({drafts.length})</h3>
          {followups.length > 0 && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setSelected(new Set(followups.map((d) => d.id)))}>Selecionar follow-ups</Button>
              <Button size="sm" disabled={pending || selected.size === 0} onClick={bulk}>Aprovar {selected.size} em lote</Button>
            </div>
          )}
        </div>
        {drafts.length === 0 && <Card className="p-8 text-center text-sm text-muted-foreground">Nada para aprovar. Rascunhos dos agentes aparecem aqui.</Card>}
        {drafts.map((d) => <DraftCard key={d.id} d={d} checked={selected.has(d.id)} onToggle={() => toggle(d.id)} />)}
      </section>
    </div>
  );
}

function DraftCard({ d, checked, onToggle }: { d: DraftView; checked: boolean; onToggle: () => void }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [body, setBody] = React.useState(d.body);
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const edited = body.trim() !== d.body.trim();
  function act(fn: () => Promise<{ ok: true; data: { status?: string; reason?: string } } | { ok: false; errors: Record<string, string[]> }>, msg: string) {
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(getFormError(r.errors));
      if (r.data.status === "blocked") toast.warning(`Bloqueado pela política de envio${r.data.reason ? `: ${r.data.reason}` : "."}`); else toast.success(msg);
      router.refresh();
    });
  }
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {d.role === "followup" && <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Selecionar rascunho para ${d.leadName}`} />}
        <p className="text-sm font-medium">{d.leadName}{d.company ? ` · ${d.company}` : ""}</p>
        <Badge variant="muted">{ROLE_LABELS[d.role]}</Badge><Badge variant="muted">{d.channel}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">{d.agentName} · {new Date(d.createdAt).toLocaleString("pt-BR")}</span>
      </div>
      <textarea aria-label={`Mensagem para ${d.leadName}`} className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
      {rejecting ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input aria-label="Motivo da rejeição" placeholder="Motivo da rejeição" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          <Button variant="destructive" disabled={pending || !reason.trim()} onClick={() => act(() => rejectDraftAction({ id: d.id, reason }).then((r) => (r.ok ? { ok: true as const, data: {} } : r)), "Rascunho rejeitado.")}>Confirmar rejeição</Button>
          <Button variant="outline" onClick={() => setRejecting(false)}>Cancelar</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending || !body.trim()} onClick={() => act(() => approveDraft({ id: d.id, ...(edited ? { editedBody: body } : {}) }), edited ? "Editado e enviado." : "Aprovado e enviado.")}>{edited ? "Salvar e enviar" : "Aprovar e enviar"}</Button>
          <Button variant="outline" disabled={pending} onClick={() => setRejecting(true)}>Rejeitar</Button>
        </div>
      )}
    </Card>
  );
}
