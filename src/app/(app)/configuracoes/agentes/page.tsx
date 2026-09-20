import { Lock } from "lucide-react";
import { AgentsPanel } from "@/components/agents/AgentsPanel";
import { Card } from "@/components/ui/card";
import { getAgentUsage } from "@/lib/actions/agent";
import { requireUser } from "@/lib/auth/require-user";
import { getAgentSettings, listAgents } from "@/lib/queries/agent";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireUser();
  if (user.role !== "admin") {
    return (
      <Card role="alert" className="flex flex-col items-center gap-2 p-10 text-center">
        <Lock className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-heading text-lg font-semibold">Você não tem permissão para gerenciar agentes</p>
        <p className="text-sm text-muted-foreground">Somente administradores configuram os agentes. Você ainda pode revisar rascunhos em Aprovações.</p>
      </Card>
    );
  }
  const [agents, settings] = await Promise.all([listAgents(), getAgentSettings()]);
  const views = await Promise.all(
    agents.map(async (a) => {
      const u = await getAgentUsage({ id: a.id });
      return {
        id: a.id, role: a.role, name: a.name, active: a.active, persona: a.persona, objective: a.objective, tone: a.tone, model: a.model,
        autonomy: a.autonomy, samplePercent: a.samplePercent, monthlyBudgetCents: a.monthlyBudgetCents, dailyMessageLimit: a.dailyMessageLimit,
        maxTurnsPerLead: a.maxTurnsPerLead, allowedTools: a.allowedTools as string[], escalationRules: a.escalationRules,
        disclosureEnabled: a.disclosureEnabled, disclosureText: a.disclosureText, callLink: a.callLink, knowledge: a.knowledge,
        spentCents: u.ok ? u.data.spentCents : 0,
      };
    }),
  );
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-lg font-semibold">Agentes de IA</h2>
        <p className="text-sm text-muted-foreground">SDR, Follow-up e Closer. Todos nascem desligados e em modo rascunho.</p>
      </div>
      <AgentsPanel agents={views} settings={{ killSwitch: settings.killSwitch, monthlyBudgetCents: settings.monthlyBudgetCents }} />
    </div>
  );
}
