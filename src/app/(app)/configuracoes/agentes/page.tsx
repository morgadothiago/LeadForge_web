import { Lock } from "lucide-react";
import { AgentsPanel } from "@/components/agents/AgentsPanel";
import { Card } from "@/components/ui/card";
import { getAgentUsage } from "@/lib/actions/agent";
import { redirectIfTrialExpired, requirePageUser } from "@/lib/auth/require-page";
import { getAgentSettings, listAgents } from "@/lib/queries/agent";
import { aiBudgetForViewer, getAiBudget, getTenantEntitlements } from "@/lib/queries/entitlements";
import { toAgentPlanView } from "@/components/agents/agent-format";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requirePageUser();
  await redirectIfTrialExpired(); // SPEC-065 (D-065-13.3)
  if (user.platformRole !== "provider") {
    return (
      <Card role="alert" className="flex flex-col items-center gap-2 p-10 text-center">
        <Lock className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-heading text-lg font-semibold">Esta área é da organização do cliente</p>
        <p className="text-sm text-muted-foreground">Os agentes são usados pela organização do cliente. A política deles (modelo, custo e limites) é configurada em Admin &gt; Organizações.</p>
      </Card>
    );
  }
  const [agents, settings, ent, aiBudget] = await Promise.all([listAgents(), getAgentSettings(), getTenantEntitlements(), getAiBudget().catch(() => null)])
  const ownerBudget = aiBudgetForViewer(ent.isOwner, aiBudget); // SPEC-069e: gasto de IA da org so vai ao navegador do owner;
  const views = await Promise.all(
    agents.map(async (a: (typeof agents)[number]) => {
      const u = await getAgentUsage({ id: a.id });
      return {
        id: a.id, role: a.role, name: a.name, active: a.active, persona: a.persona, objective: a.objective, tone: a.tone, model: a.model,
        autonomy: a.autonomy, samplePercent: a.samplePercent, monthlyBudgetCents: a.monthlyBudgetCents, dailyMessageLimit: a.dailyMessageLimit,
        maxTurnsPerLead: a.maxTurnsPerLead, allowedTools: a.allowedTools as string[], escalationRules: a.escalationRules,
        disclosureEnabled: a.disclosureEnabled, disclosureText: a.disclosureText, callLink: a.callLink, brief: a.brief, knowledge: a.knowledge,
        spentCents: u.ok ? u.data.spentCents : 0,
      };
    }),
  );
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-lg font-semibold">Agentes de IA</h2>
        <p className="text-sm text-muted-foreground">SDR, Follow-up e Closer. Todos nascem desligados e em modo rascunho. Você preenche briefings guiados (persona, oferta, público, objeções, o que evitar, assinatura, exemplos e conhecimento); modelo, custo, limites e regras de segurança são definidos pela plataforma.</p>
      </div>
      <AgentsPanel
        agents={views}
        settings={{ killSwitch: settings.killSwitch, monthlyBudgetCents: settings.monthlyBudgetCents, lockedByAdmin: "lockedByAdmin" in settings ? settings.lockedByAdmin : false }}
        plan={toAgentPlanView(ent, agents.filter((a: (typeof agents)[number]) => a.active).length)}
        aiBudget={ownerBudget}
        isOwner={ent.isOwner}
      />
    </div>
  );
}
