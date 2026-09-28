"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bot, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldPath } from "react-hook-form";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { getFormError } from "@/components/campaigns/form-utils";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { createAgent, getAgentRuns, type AgentRunView, deleteKnowledge, saveKnowledge, setAgentActive, setAgentAutonomy, simulateAgentAction, updateAgent, updateAgentSettings } from "@/lib/actions/agent";
import type { FieldErrors } from "@/lib/actions/result";
import type { SimulationResult } from "@/lib/agents/simulate";
import type { AgentTool } from "@/lib/agents/types";
import { agentFieldsSchema, createAgentSchema, globalSettingsSchema, knowledgeSchema, simulateSchema, updateAgentSchema } from "@/lib/schemas/agent";
import { AUTONOMY_LABELS, ROLE_LABELS, formatBRLCents, RUN_STATUS_LABELS, budgetToInput, canConfirmAuto, disclosureOffDowngrades, formatMicroUsd, guardrailsLabel, needsAutoConfirm, parseLines, resolveBudgetInput, usageLevel, usagePercent } from "./agent-format";

type Role = keyof typeof ROLE_LABELS;
type Autonomy = keyof typeof AUTONOMY_LABELS;
export interface AgentView {
  id: string; role: Role; name: string; active: boolean; persona: string; objective: string; tone: string; model: string;
  autonomy: Autonomy; samplePercent: number; monthlyBudgetCents: number | null; dailyMessageLimit: number; maxTurnsPerLead: number;
  allowedTools: string[]; escalationRules: unknown; disclosureEnabled: boolean; disclosureText: string | null; callLink?: string | null;
  knowledge: { id: string; title: string; version: number }[];
  spentCents: number;
}
export interface SettingsView { killSwitch: boolean; monthlyBudgetCents: number | null }

const selectCls = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20";
const areaCls = "min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20";

function useRun() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  function run<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; errors: FieldErrors }>, ok: string, onErr?: (e: FieldErrors) => void, onOk?: (d: T) => void) {
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); onOk?.(r.data); router.refresh(); } else { onErr?.(r.errors); toast.error(getFormError(r.errors)); }
    });
  }
  return { run, pending };
}

export function AgentsPanel({ agents, settings }: { agents: AgentView[]; settings: SettingsView }) {
  const [editing, setEditing] = React.useState<AgentView | "new" | null>(null);
  const { run, pending } = useRun();
  const [confirmRelease, setConfirmRelease] = React.useState(false);
  const missing = (["sdr", "followup", "closer"] as Role[]).filter((r) => !agents.some((a) => a.role === r));
  return (
    <div className="space-y-6">
      <Card className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${settings.killSwitch ? "border-destructive/50" : ""}`}>
        <div className="flex items-start gap-3">
          <Power className={`mt-0.5 size-5 ${settings.killSwitch ? "text-destructive" : "text-success"}`} aria-hidden="true" />
          <div>
            <p className="font-medium">Kill switch global: {settings.killSwitch ? "LIGADO (todos os agentes parados)" : "desligado (agentes ativos podem rodar)"}</p>
            <p className="text-xs text-muted-foreground">Teto global do mês: {settings.monthlyBudgetCents ? formatBRLCents(settings.monthlyBudgetCents) : "não definido"}. Pausa automática em 100%, alerta em 80%.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <GlobalBudget key={settings.monthlyBudgetCents ?? "none"} current={settings.monthlyBudgetCents} />
          <Button variant={settings.killSwitch ? "default" : "destructive"} disabled={pending} onClick={() => (settings.killSwitch ? setConfirmRelease(true) : run(() => updateAgentSettings({ killSwitch: true }), "Todos os agentes foram parados."))}>
            {settings.killSwitch ? "Liberar agentes" : "Parar todos"}
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmRelease}
        onOpenChange={setConfirmRelease}
        title="Liberar agentes?"
        description="Os agentes ativos voltam a rodar e podem gerar rascunhos (e enviar, conforme a autonomia). Confirme apenas se o motivo da parada foi resolvido."
        confirmLabel="Liberar agentes"
        pending={pending}
        onConfirm={() => run(() => updateAgentSettings({ killSwitch: false }), "Agentes liberados.", undefined, () => setConfirmRelease(false))}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">O agente propõe; supressão, cadência, janela e saúde do chip continuam decidindo se a mensagem sai.</p>
        <Button onClick={() => setEditing("new")} disabled={missing.length === 0}><Plus /> Novo agente</Button>
      </div>

      {agents.length === 0 && <Card className="p-8 text-center text-sm text-muted-foreground">Nenhum agente ainda. Crie o SDR e o Follow-up primeiro (sempre em modo rascunho).</Card>}
      <div className="grid gap-4 lg:grid-cols-2">
        {agents.map((a) => <AgentCard key={a.id} agent={a} killSwitch={settings.killSwitch} onEdit={() => setEditing(a)} />)}
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          {editing && <AgentForm key={editing === "new" ? "new" : editing.id} agent={editing === "new" ? null : editing} availableRoles={editing === "new" ? missing : []} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Valores do form (SPEC-044): números ficam como texto na UI e viram número no submit; erros usam as chaves do schema ("monthlyBudgetCents", "dailyMessageLimit", ...). */
interface GlobalBudgetValues {
  monthlyBudgetCents: string;
}

type GlobalBudgetSubmit = z.output<typeof globalSettingsSchema>;

/** Texto em reais → cents; vazio/inválido vira `null` (o formato é checado em `onSubmit` com as mensagens originais). */
function budgetCentsOf(text: string): number | null {
  if (!text.trim()) return null;
  const r = resolveBudgetInput(text);
  return r.ok ? r.cents : null;
}

function GlobalBudget({ current }: { current: number | null }) {
  const [confirmClear, setConfirmClear] = React.useState(false);
  const { run, pending } = useRun();
  const resolver = React.useMemo(
    () => zodResolver(z.preprocess((v: GlobalBudgetValues) => ({ monthlyBudgetCents: budgetCentsOf(v.monthlyBudgetCents) }), globalSettingsSchema)),
    [],
  );
  const { register, handleSubmit, getValues, setError, formState } = useForm<GlobalBudgetValues, unknown, GlobalBudgetSubmit>({
    resolver,
    defaultValues: { monthlyBudgetCents: budgetToInput(current) },
  });
  const { errors } = formState;

  const onSubmit = handleSubmit(() => {
    const text = getValues().monthlyBudgetCents;
    if (!text.trim()) {
      if (current) { setConfirmClear(true); return; }
      setError("monthlyBudgetCents", { type: "client", message: "Informe um valor em reais maior que zero." });
      return;
    }
    const r = resolveBudgetInput(text);
    if (!r.ok) { setError("monthlyBudgetCents", { type: "client", message: r.error }); return; }
    run(() => updateAgentSettings({ monthlyBudgetCents: r.cents }), "Teto global salvo.");
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1" noValidate>
      <div className="flex gap-2">
        <Input aria-label="Teto global mensal em reais" inputMode="decimal" className="w-28" placeholder="R$ teto" {...register("monthlyBudgetCents")} />
        <Button type="submit" variant="outline" disabled={pending}>Salvar teto</Button>
      </div>
      {errors.monthlyBudgetCents && <p role="alert" className="text-xs text-destructive">{errors.monthlyBudgetCents.message}</p>}
      <ConfirmDialog open={confirmClear} onOpenChange={setConfirmClear} title="Remover teto global?" description="Sem teto global, o gasto mensal dos agentes deixa de ter limite conjunto." confirmLabel="Remover teto" destructive pending={pending}
        onConfirm={() => run(() => updateAgentSettings({ monthlyBudgetCents: null }), "Teto global removido.", undefined, () => setConfirmClear(false))} />
    </form>
  );
}

function AgentCard({ agent: a, killSwitch, onEdit }: { agent: AgentView; killSwitch: boolean; onEdit: () => void }) {
  const { run, pending } = useRun();
  const [sim, setSim] = React.useState(false);
  const [auto, setAuto] = React.useState<Autonomy | null>(null);
  const level = usageLevel(a.spentCents, a.monthlyBudgetCents);
  const pct = usagePercent(a.spentCents, a.monthlyBudgetCents);
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><Bot className="size-4 text-primary" aria-hidden="true" /><h3 className="truncate font-heading font-semibold">{a.name}</h3></div>
          <p className="text-xs text-muted-foreground">{ROLE_LABELS[a.role]} · {a.model}</p>
        </div>
        <Badge variant={a.active && !killSwitch ? "default" : "muted"}>{killSwitch ? "Parado (kill switch)" : a.active ? "Ativo" : "Desligado"}</Badge>
      </div>

      <div>
        <div className="flex justify-between text-xs"><span>Uso do mês</span><span>{formatBRLCents(a.spentCents)} / {a.monthlyBudgetCents ? formatBRLCents(a.monthlyBudgetCents) : "sem teto"}</span></div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Uso do orçamento mensal">
          <div className={`h-full ${level === "stop" ? "bg-destructive" : level === "warn" ? "bg-warning" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
        {level === "warn" && <p role="alert" className="mt-1 flex items-center gap-1 text-xs text-warning"><AlertTriangle className="size-3" aria-hidden="true" /> Atenção: {pct}% do teto mensal usado. Em 100% o agente pausa.</p>}
        {level === "stop" && <p role="alert" className="mt-1 flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="size-3" aria-hidden="true" /> Teto atingido: agente pausado até o próximo mês ou aumento do teto.</p>}
      </div>

      <Field id={`aut-${a.id}`} label="Autonomia">
        {(f) => (
          <select {...f} className={selectCls} value={a.autonomy} disabled={pending} onChange={(e) => {
            const v = e.target.value as Autonomy;
            if (needsAutoConfirm(a.role, v)) setAuto(v);
            else run(() => setAgentAutonomy({ id: a.id, autonomy: v }), "Autonomia atualizada.");
          }}>
            {(Object.keys(AUTONOMY_LABELS) as Autonomy[]).map((k) => <option key={k} value={k}>{AUTONOMY_LABELS[k]}{k === "sampled" ? ` (${a.samplePercent}% revisados)` : ""}</option>)}
          </select>
        )}
      </Field>

      <p className="text-xs text-muted-foreground">{a.knowledge.length} documento(s) de conhecimento · {a.dailyMessageLimit} msgs/dia · {a.maxTurnsPerLead} turnos/lead</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onEdit}>Editar</Button>
        <Button size="sm" variant="outline" onClick={() => setSim(true)}>Simular</Button>
        <Button size="sm" variant={a.active ? "secondary" : "default"} disabled={pending} onClick={() => run(() => setAgentActive({ id: a.id, active: !a.active }), a.active ? "Agente desligado." : "Agente ativado.")}>
          {a.active ? "Desligar" : "Ativar"}
        </Button>
      </div>
      <RunHistory agentId={a.id} />
      {auto && <CloserAutoDialog agent={a} autonomy={auto} onClose={() => setAuto(null)} />}
      {sim && <SimulateDialog agent={a} onClose={() => setSim(false)} />}
    </Card>
  );
}

function RunHistory({ agentId }: { agentId: string }) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<"idle" | "loading" | "error" | "ready">("idle");
  const [runs, setRuns] = React.useState<AgentRunView[]>([]);
  const [msg, setMsg] = React.useState("");
  async function load() {
    setState("loading");
    const r = await getAgentRuns({ id: agentId }).catch(() => null);
    if (r?.ok) { setRuns(r.data); setState("ready"); } else { setMsg(r ? getFormError(r.errors) : "Falha ao carregar."); setState("error"); }
  }
  return (
    <div className="border-t border-border pt-3">
      <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => { const n = !open; setOpen(n); if (n) void load(); }}>{open ? "Ocultar execuções" : "Ver execuções"}</Button>
      {open && (
        <div className="mt-2 text-xs" aria-live="polite">
          {state === "loading" && <p className="text-muted-foreground">Carregando execuções…</p>}
          {state === "error" && <p role="alert" className="text-destructive">{msg} <button type="button" className="underline" onClick={() => void load()}>Tentar de novo</button></p>}
          {state === "ready" && runs.length === 0 && <p className="text-muted-foreground">Nenhuma execução ainda.</p>}
          {state === "ready" && runs.length > 0 && (
            <>
              <ul className="divide-y divide-border">
                {runs.map((r) => (
                  <li key={r.id} className="space-y-0.5 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={r.status === "done" ? "default" : "muted"}>{RUN_STATUS_LABELS[r.status] ?? r.status}</Badge>
                      <span>{new Date(r.createdAt).toLocaleString("pt-BR")}</span>
                      <span className="ml-auto text-muted-foreground">custo {formatMicroUsd(r.costMicros)}</span>
                    </div>
                    {guardrailsLabel(r.guardrailsViolated) && <p className="text-destructive">Guardrails: {guardrailsLabel(r.guardrailsViolated)}</p>}
                    {r.error && <p className="text-muted-foreground">Motivo: {r.error}</p>}
                  </li>
                ))}
              </ul>
              {runs.length >= 50 && <p className="pt-1 text-muted-foreground">Mostrando as 50 mais recentes.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CloserAutoDialog({ agent, autonomy, onClose }: { agent: AgentView; autonomy: Autonomy; onClose: () => void }) {
  const [c1, setC1] = React.useState(false);
  const [c2, setC2] = React.useState(false);
  const { run, pending } = useRun();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dar autonomia ao Closer?</DialogTitle>
          <DialogDescription>O Closer conversa com leads que responderam. Aviso de IA ligado: {agent.disclosureEnabled ? "sim" : "NÃO (ligue antes em Editar)"}.</DialogDescription>
        </DialogHeader>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={c1} onChange={(e) => setC1(e.target.checked)} className="mt-1" /> Confirmo que o Closer poderá enviar mensagens {autonomy === "auto" ? "sozinho" : "sem revisão em parte dos casos"}.</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={c2} onChange={(e) => setC2(e.target.checked)} className="mt-1" /> Estou ciente do risco de banimento do número e das obrigações da LGPD.</label>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
          <Button disabled={!canConfirmAuto(c1, c2, agent.disclosureEnabled, pending)} onClick={() => run(() => setAgentAutonomy({ id: agent.id, autonomy, confirmAuto: c1, acknowledgeRisk: c2 }), "Autonomia atualizada.", undefined, onClose)}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Valores do form de simulação (SPEC-044): `text` vira `inboundText` só quando preenchido (trim), como no original. */
interface SimulateValues {
  text: string;
}

type SimulateSubmit = z.output<typeof simulateSchema>;

function SimulateDialog({ agent, onClose }: { agent: AgentView; onClose: () => void }) {
  const [res, setRes] = React.useState<SimulationResult | null>(null);
  const [pending, start] = React.useTransition();
  const resolver = React.useMemo(
    () =>
      zodResolver(
        z.preprocess(
          (v: SimulateValues) => ({ agentId: agent.id, ...(v.text.trim() ? { inboundText: v.text.trim() } : {}) }),
          simulateSchema,
        ),
      ),
    [agent.id],
  );
  const { register, handleSubmit } = useForm<SimulateValues, unknown, SimulateSubmit>({ resolver, defaultValues: { text: "" } });
  const onSubmit = handleSubmit((values) => {
    start(async () => {
      const r = await simulateAgentAction(values);
      if (r.ok) setRes(r.data); else toast.error(getFormError(r.errors));
    });
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Simular: {agent.name}</DialogTitle>
          <DialogDescription>Teste com um lead de exemplo. Nada é enviado nem salvo, mas a chamada ao modelo tem custo.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field id="sim-text" label="Mensagem do lead (opcional)" hint="Vazio simula o primeiro contato.">
            {(f) => <textarea {...f} {...register("text")} className={areaCls} maxLength={1000} />}
          </Field>
          <Button type="submit" disabled={pending}>{pending ? "Simulando…" : "Simular"}</Button>
        </form>
        {res && (
          <div className="space-y-2 rounded-md border border-border p-3 text-sm" aria-live="polite">
            <p><strong>Ação:</strong> {res.output.action} · confiança {Math.round(res.output.confidence * 100)}%</p>
            {res.message && <p className="whitespace-pre-wrap rounded bg-muted p-2">{res.message}</p>}
            {res.violations.length > 0 ? <p className="text-destructive">Guardrails violados: {res.violations.join(", ")} (seria bloqueada)</p> : <p className="text-success">Nenhum guardrail violado.</p>}
            <p className="text-xs text-muted-foreground">{res.tokensIn} tokens de entrada, {res.tokensOut} de saída · custo {formatMicroUsd(res.costMicros)}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Valores do formulário (SPEC-044). Números entram como texto; as chaves de erro espelham o schema do server. */
interface AgentFormValues {
  role: Role;
  name: string;
  persona: string;
  objective: string;
  tone: string;
  model: string;
  monthlyBudgetCents: string;
  clearBudget: boolean;
  dailyMessageLimit: string;
  maxTurnsPerLead: string;
  samplePercent: string;
  link: boolean;
  tag: boolean;
  keywords: string;
  forbidden: string;
  humanReq: boolean;
  disclosure: boolean;
  disclosureText: string;
  callLink: string;
}

type AgentSubmit = z.output<typeof createAgentSchema> | z.output<typeof updateAgentSchema>;

/** Monta o body do submit (mesmo shape do original). Erro de formato do teto vira `null` aqui e é barrado em `onSubmit`. */
function buildBody(v: AgentFormValues, agent: AgentView | null): z.input<typeof agentFieldsSchema> {
  const hadBudget = !!agent?.monthlyBudgetCents;
  const b = !v.monthlyBudgetCents.trim() && !hadBudget ? ({ ok: true, cents: null } as const) : resolveBudgetInput(v.monthlyBudgetCents, v.clearBudget);
  const allowedTools: AgentTool[] = [];
  if (v.link) allowedTools.push("link");
  if (v.tag) allowedTools.push("tag");
  return {
    name: v.name,
    persona: v.persona,
    objective: v.objective,
    tone: v.tone,
    model: v.model,
    monthlyBudgetCents: b.ok ? b.cents : null,
    dailyMessageLimit: Number(v.dailyMessageLimit),
    maxTurnsPerLead: Number(v.maxTurnsPerLead),
    samplePercent: Number(v.samplePercent),
    allowedTools,
    escalationRules: { keywords: parseLines(v.keywords), forbiddenPhrases: parseLines(v.forbidden), handoffOnHumanRequest: v.humanReq },
    disclosureEnabled: v.disclosure,
    disclosureText: v.disclosureText.trim() || null,
    ...(v.role === "closer" ? { callLink: v.callLink.trim() || null } : {}),
  };
}

function AgentForm({ agent, availableRoles, onDone }: { agent: AgentView | null; availableRoles: Role[]; onDone: () => void }) {
  const uid = React.useId();
  const rules = (agent?.escalationRules ?? {}) as { keywords?: string[]; forbiddenPhrases?: string[]; handoffOnHumanRequest?: boolean };
  const { run, pending } = useRun();

  const resolver = React.useMemo(
    () =>
      agent
        ? zodResolver(z.preprocess((v: AgentFormValues) => ({ ...buildBody(v, agent), id: agent.id }), updateAgentSchema))
        : zodResolver(z.preprocess((v: AgentFormValues) => ({ ...buildBody(v, null), role: v.role }), createAgentSchema)),
    [agent],
  );

  const { register, handleSubmit, watch, getValues, setValue, setError, setFocus, formState } = useForm<AgentFormValues, unknown, AgentSubmit>({
    resolver,
    defaultValues: {
      role: agent?.role ?? availableRoles[0] ?? "sdr",
      name: agent?.name ?? "",
      persona: agent?.persona ?? "",
      objective: agent?.objective ?? "",
      tone: agent?.tone ?? "",
      model: agent?.model ?? "claude-haiku-4-5",
      monthlyBudgetCents: budgetToInput(agent?.monthlyBudgetCents ?? null),
      clearBudget: false,
      dailyMessageLimit: String(agent?.dailyMessageLimit ?? 20),
      maxTurnsPerLead: String(agent?.maxTurnsPerLead ?? 5),
      samplePercent: String(agent?.samplePercent ?? 20),
      link: agent?.allowedTools.includes("link") ?? false,
      tag: agent?.allowedTools.includes("tag") ?? false,
      keywords: (rules.keywords ?? []).join("\n"),
      forbidden: (rules.forbiddenPhrases ?? []).join("\n"),
      humanReq: rules.handoffOnHumanRequest ?? true,
      disclosure: agent?.disclosureEnabled ?? (agent?.role ?? availableRoles[0] ?? "sdr") === "closer",
      disclosureText: agent?.disclosureText ?? "",
      callLink: agent?.callLink ?? "",
    },
  });
  const { errors } = formState;

  const role = watch("role");
  const disclosure = watch("disclosure");
  const clearBudget = watch("clearBudget");

  /** Erros vindos do server (ActionResult): chaves do schema ("name", "dailyMessageLimit", "escalationRules.keywords", ...) + `_form` no banner. */
  function applyServerErrors(errs: FieldErrors) {
    let first: FieldPath<AgentFormValues> | undefined;
    for (const [key, msgs] of Object.entries(errs)) {
      if (key === "_form") continue;
      const path = key as FieldPath<AgentFormValues>;
      first ??= path;
      setError(path, { type: "server", message: msgs.join(" ") });
    }
    if (errs._form) setError("root", { type: "server", message: errs._form.join(" ") });
    if (first) setFocus(first.replace(/\.\d+$/, "") as FieldPath<AgentFormValues>);
  }

  const onSubmit = handleSubmit((values) => {
    // Pré-checagem do teto (regra só existente na UI): mensagens originais de resolveBudgetInput.
    const fv = getValues();
    const hadBudget = !!agent?.monthlyBudgetCents;
    const b = !fv.monthlyBudgetCents.trim() && !hadBudget ? ({ ok: true, cents: null } as const) : resolveBudgetInput(fv.monthlyBudgetCents, fv.clearBudget);
    if (!b.ok) {
      setError("monthlyBudgetCents", { type: "client", message: b.error });
      setFocus("monthlyBudgetCents");
      return;
    }
    run(() => (agent ? updateAgent(values) : createAgent(values)), agent ? "Agente salvo." : "Agente criado (desligado, em rascunho).", applyServerErrors, onDone);
  });

  const area = (id: "persona" | "objective" | "tone" | "keywords" | "forbidden", label: string, hint?: string) => (
    <Field id={`${uid}-${id}`} label={label} hint={hint} error={errors[id]?.message}>{(f) => <textarea {...f} {...register(id)} className={areaCls} />}</Field>
  );
  const num = (id: "dailyMessageLimit" | "maxTurnsPerLead" | "samplePercent", label: string) => (
    <Field id={`${uid}-${id}`} label={label} error={errors[id]?.message}>{(f) => <Input {...f} {...register(id)} inputMode="numeric" />}</Field>
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{agent ? `Editar ${agent.name}` : "Novo agente"}</DialogTitle>
        <DialogDescription>Cada alteração gera uma nova versão do prompt base.</DialogDescription>
      </DialogHeader>
      {errors.root?.message && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{errors.root.message}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${uid}-role`} label="Papel" required>
          {(f) => <select {...f} className={selectCls} value={role} disabled={!!agent} onChange={(e) => { const r = e.target.value as Role; setValue("role", r); setValue("disclosure", r === "closer"); }}>
            {(agent ? [agent.role] : availableRoles).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>}
        </Field>
        <Field id={`${uid}-name`} label="Nome" required error={errors.name?.message}>{(f) => <Input {...f} {...register("name")} maxLength={80} />}</Field>
      </div>
      {area("persona", "Persona", "Quem é o agente e como se apresenta.")}
      {area("objective", "Objetivo")}
      {area("tone", "Tom de voz")}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${uid}-model`} label="Modelo" error={errors.model?.message}>{(f) => <Input {...f} {...register("model")} />}</Field>
        <Field id={`${uid}-budget`} label="Teto mensal (R$)" hint="Obrigatório para ativar." error={errors.monthlyBudgetCents?.message}>
          {(f) => <div className="space-y-1"><Input {...f} {...register("monthlyBudgetCents")} inputMode="decimal" disabled={clearBudget} />
            {agent?.monthlyBudgetCents ? <label className="flex gap-2 text-xs"><input type="checkbox" checked={clearBudget} onChange={(e) => { const on = e.target.checked; setValue("clearBudget", on); setValue("monthlyBudgetCents", on ? "" : budgetToInput(agent.monthlyBudgetCents), { shouldValidate: true }); }} /> Remover teto (o agente não poderá ficar ativo)</label> : null}</div>}
        </Field>
        {num("dailyMessageLimit", "Limite diário de mensagens")}
        {num("maxTurnsPerLead", "Turnos máximos por lead")}
        {num("samplePercent", "% revisado na amostragem")}
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Ferramentas permitidas</legend>
        <label className="flex gap-2 text-sm"><input type="checkbox" {...register("link")} /> Incluir links nas mensagens</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" {...register("tag")} /> Aplicar tags aos leads</label>
      </fieldset>
      <fieldset className="grid gap-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Regras de escalonamento (passar para humano)</legend>
        {area("keywords", "Palavras/temas sensíveis (um por linha)")}
        {area("forbidden", "Frases proibidas (uma por linha)")}
        <label className="flex gap-2 text-sm"><input type="checkbox" {...register("humanReq")} /> Passar para humano quando o lead pedir</label>
      </fieldset>
      {role === "closer" && (
        <Field id={`${uid}-call`} label="Link da call" hint="Será o único link permitido na mensagem e vai ao humano no handoff." error={errors.callLink?.message}>
          {(f) => <Input {...f} {...register("callLink")} type="url" inputMode="url" placeholder="https://" />}
        </Field>
      )}
      <fieldset className="grid gap-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Transparência</legend>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={disclosure} onChange={(e) => setValue("disclosure", e.target.checked)} /> Avisar que é um assistente de IA{role === "closer" ? " (recomendado no Closer)" : ""}</label>
        {agent && !disclosure && disclosureOffDowngrades(agent.role, agent.autonomy, disclosure) && <p role="alert" className="text-sm text-warning">Ao desligar o aviso, este Closer autônomo volta para o modo rascunho (você aprova tudo).</p>}
        {disclosure && <Field id={`${uid}-dt`} label="Texto do aviso" hint="Vazio usa o texto padrão.">{(f) => <Input {...f} {...register("disclosureText")} maxLength={300} />}</Field>}
      </fieldset>
      {agent && <KnowledgeSection agent={agent} />}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar"}</Button>
      </DialogFooter>
    </form>
  );
}

/** Valores do form de conhecimento (SPEC-044): `agentId` é injetado no submit. */
interface KnowledgeValues {
  title: string;
  content: string;
}

type KnowledgeSubmit = z.output<typeof knowledgeSchema>;

function KnowledgeSection({ agent }: { agent: AgentView }) {
  const { run, pending } = useRun();
  const [removing, setRemoving] = React.useState<{ id: string; title: string } | null>(null);
  const resolver = React.useMemo(
    () => zodResolver(z.preprocess((v: KnowledgeValues) => ({ agentId: agent.id, title: v.title, content: v.content }), knowledgeSchema)),
    [agent.id],
  );
  const { register, handleSubmit, setError, reset, formState } = useForm<KnowledgeValues, unknown, KnowledgeSubmit>({
    resolver,
    defaultValues: { title: "", content: "" },
  });
  const { errors } = formState;

  function applyServerErrors(errs: FieldErrors) {
    for (const [key, msgs] of Object.entries(errs)) {
      if (key === "_form") continue;
      setError(key as FieldPath<KnowledgeValues>, { type: "server", message: msgs.join(" ") });
    }
    if (errs._form) setError("root", { type: "server", message: errs._form.join(" ") });
  }

  // Botão `type="button"` dentro do form do AgentForm: o submit do knowledge é disparado via handleSubmit explícito.
  const onAdd = handleSubmit((values) => {
    run(() => saveKnowledge(values), "Documento salvo.", applyServerErrors, () => reset({ title: "", content: "" }));
  });

  return (
    <fieldset className="grid gap-3 rounded-md border border-border p-3">
      <ConfirmDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)} title="Remover documento?" description={`"${removing?.title ?? ""}" deixará de ser usado pelo agente. Esta ação não pode ser desfeita.`} confirmLabel="Remover" destructive pending={pending}
        onConfirm={() => removing && run(() => deleteKnowledge({ id: removing.id }), "Documento removido.", undefined, () => setRemoving(null))} />
      <legend className="px-1 text-sm font-medium">Base de conhecimento</legend>
      <p className="text-xs text-muted-foreground">O agente só pode citar preços, prazos e condições que estiverem aqui.</p>
      <ul className="space-y-1">
        {agent.knowledge.map((k) => (
          <li key={k.id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{k.title} <span className="text-xs text-muted-foreground">v{k.version}</span></span>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setRemoving({ id: k.id, title: k.title })}>Remover</Button></li>
        ))}
      </ul>
      <Input aria-label="Título do documento" placeholder="Título" maxLength={120} aria-invalid={!!errors.title} {...register("title")} />
      {errors.title && <p role="alert" className="text-xs text-destructive">{errors.title.message}</p>}
      <textarea aria-label="Conteúdo do documento" className={areaCls} placeholder="Conteúdo (texto)" maxLength={20000} aria-invalid={!!errors.content} {...register("content")} />
      {errors.content && <p role="alert" className="text-xs text-destructive">{errors.content.message}</p>}
      <Button type="button" variant="outline" disabled={pending} onClick={onAdd}>Adicionar documento</Button>
    </fieldset>
  );
}
