"use client";
import * as React from "react";
import { Lock, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { fieldError } from "@/components/campaigns/form-utils";
import { setAgentPolicyByAdmin, setOrgAgentSettingsByAdmin } from "@/lib/actions/admin/entitlements";
import type { OrgPolicyView } from "@/lib/queries/admin/org-policy";
import { AGENT_ROLE_LABEL, AUTONOMY_LABEL, centsToReaisInput, formatBRL, formatLimit, reaisToCents } from "./policy-format";
import { FormError, ReasonField, Section, useAdminAction } from "./policy-ui";

/** SPEC-069c — aba "Agentes e IA": kill switch/trava/teto da organização e política de cada agente (modelo, teto, mensagens/dia, turnos). Sem persona/conhecimento (D-069-2). */
export function AgentsPolicyTab({ policy }: { policy: OrgPolicyView }) {
  return (
    <div className="space-y-4">
      <OrgSettingsForm policy={policy} />
      <Section title="Agentes da organização" description="Política por agente. O conteúdo (persona, objetivo, tom) é do cliente e não aparece aqui.">
        {policy.agents.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">Esta organização ainda não criou agentes.</p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {policy.agents.map((a) => (
              <li key={a.id}>
                <AgentPolicyForm orgId={policy.org.id} agent={a} planMessagesCap={policy.effective.limits.maxAgentMessagesPerDay} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function OrgSettingsForm({ policy }: { policy: OrgPolicyView }) {
  const uid = React.useId();
  const s = policy.agentSettings;
  const [killSwitch, setKillSwitch] = React.useState(s.killSwitch);
  const [locked, setLocked] = React.useState(s.lockedByAdmin);
  const [budget, setBudget] = React.useState(centsToReaisInput(s.monthlyBudgetCents));
  const [reason, setReason] = React.useState("");
  const { run, errors, pending, setErrors } = useAdminAction();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cents = reaisToCents(budget);
    if (Number.isNaN(cents)) return setErrors({ monthlyBudgetCents: ["Valor inválido. Use o formato 50,00."] });
    run(
      () => setOrgAgentSettingsByAdmin({ orgId: policy.org.id, reason, killSwitch, lockedByAdmin: locked, monthlyBudgetCents: cents }),
      "Política da organização atualizada.",
      () => setReason(""),
    );
  }

  return (
    <Section
      title="Kill switch e teto da organização"
      description="O kill switch pausa todos os agentes. Com a trava ligada, o cliente só consegue LIGAR o kill switch (emergência); desligar exige o admin."
      action={killSwitch ? <Badge variant="destructive">Agentes pausados</Badge> : <Badge variant="muted">Agentes liberados</Badge>}
    >
      <form onSubmit={submit} noValidate className="grid gap-4">
        <FormError errors={errors} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor={`${uid}-kill`} className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 text-sm">
            <input id={`${uid}-kill`} type="checkbox" checked={killSwitch} onChange={(e) => setKillSwitch(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                <ShieldAlert className="size-4 text-destructive" aria-hidden="true" /> Kill switch ligado (pausar todos os agentes)
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">Nenhum agente da organização roda enquanto estiver ligado.</span>
            </span>
          </label>
          <label htmlFor={`${uid}-lock`} className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 text-sm">
            <input id={`${uid}-lock`} type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                <Lock className="size-4" aria-hidden="true" /> Travar o kill switch (só o admin desliga)
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">O cliente continua podendo ligá-lo em emergência.</span>
            </span>
          </label>
        </div>
        <div className="max-w-xs">
          <Field
            id={`${uid}-budget`}
            label="Teto de custo mensal de IA da organização (R$)"
            error={fieldError(errors, "monthlyBudgetCents")}
            hint={`Vazio = sem teto próprio. O teto do plano (${formatBRL(policy.effective.limits.maxAiBudgetCentsMonth ?? 0)}${policy.effective.limits.maxAiBudgetCentsMonth === null ? ", ilimitado" : ""}) vale de qualquer forma.`}
          >
            {(a) => <Input {...a} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Ex.: 50,00" />}
          </Field>
        </div>
        <ReasonField id={`${uid}-reason`} value={reason} onChange={setReason} error={fieldError(errors, "reason")} />
        <div className="flex justify-end">
          <Button type="submit" disabled={pending} className="h-11 w-full sm:h-9 sm:w-auto">
            {pending ? "Salvando…" : "Salvar política da organização"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function AgentPolicyForm({ orgId, agent, planMessagesCap }: { orgId: string; agent: OrgPolicyView["agents"][number]; planMessagesCap: number | null }) {
  const uid = React.useId();
  const [model, setModel] = React.useState(agent.model);
  const [budget, setBudget] = React.useState(centsToReaisInput(agent.monthlyBudgetCents));
  const [daily, setDaily] = React.useState(String(agent.dailyMessageLimit));
  const [turns, setTurns] = React.useState(String(agent.maxTurnsPerLead));
  const [reason, setReason] = React.useState("");
  const { run, errors, pending, setErrors } = useAdminAction();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cents = reaisToCents(budget);
    if (Number.isNaN(cents)) return setErrors({ monthlyBudgetCents: ["Valor inválido. Use o formato 50,00."] });
    run(
      () => setAgentPolicyByAdmin({ orgId, agentId: agent.id, reason, model, monthlyBudgetCents: cents, dailyMessageLimit: Number(daily), maxTurnsPerLead: Number(turns) }),
      "Política do agente atualizada.",
      () => setReason(""),
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-3 rounded-lg border border-border p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium">{AGENT_ROLE_LABEL[agent.role] ?? agent.role}</h4>
        <Badge variant={agent.active ? "default" : "muted"}>{agent.active ? "Ativo" : "Inativo"}</Badge>
        <Badge variant="muted">{AUTONOMY_LABEL[agent.autonomy] ?? agent.autonomy}</Badge>
      </div>
      <FormError errors={errors} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${uid}-model`} label="Modelo" required error={fieldError(errors, "model")}>
          {(a) => <Input {...a} value={model} maxLength={60} autoComplete="off" onChange={(e) => setModel(e.target.value)} />}
        </Field>
        <Field id={`${uid}-budget`} label="Teto mensal do agente (R$)" error={fieldError(errors, "monthlyBudgetCents")} hint="Vazio = sem teto: o agente não ativa.">
          {(a) => <Input {...a} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Ex.: 30,00" />}
        </Field>
        <Field id={`${uid}-daily`} label="Mensagens por dia" required error={fieldError(errors, "dailyMessageLimit")} hint={`Teto do plano: ${formatLimit(planMessagesCap)}.`}>
          {(a) => <Input {...a} type="number" inputMode="numeric" min={1} max={500} value={daily} onChange={(e) => setDaily(e.target.value)} />}
        </Field>
        <Field id={`${uid}-turns`} label="Turnos máximos por lead" required error={fieldError(errors, "maxTurnsPerLead")}>
          {(a) => <Input {...a} type="number" inputMode="numeric" min={1} max={50} value={turns} onChange={(e) => setTurns(e.target.value)} />}
        </Field>
      </div>
      <ReasonField id={`${uid}-reason`} value={reason} onChange={setReason} error={fieldError(errors, "reason")} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className="h-11 w-full sm:h-9 sm:w-auto">
          {pending ? "Salvando…" : "Salvar agente"}
        </Button>
      </div>
    </form>
  );
}
