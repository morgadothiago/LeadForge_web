import { DraftQueue } from "@/components/agents/DraftQueue";
import { listDrafts, listNeedsHuman } from "@/lib/queries/agent";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [drafts, needs] = await Promise.all([listDrafts("pending"), listNeedsHuman()]);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-lg font-semibold">Aprovações</h2>
        <p className="text-sm text-muted-foreground">Revise o que os agentes propuseram. Aprovar não garante o envio: a política de envio ainda decide.</p>
      </div>
      <DraftQueue
        drafts={drafts.map((d) => ({ id: d.id, body: d.editedBody ?? d.body, channel: d.channel, leadName: d.lead.name, company: d.lead.company, agentName: d.agentRun.agent.name, role: d.agentRun.agent.role, createdAt: d.createdAt.toISOString() }))}
        needsHuman={needs.map((l) => ({ id: l.id, name: l.name, company: l.company, reason: l.handoffReason }))}
      />
    </div>
  );
}
