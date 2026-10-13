"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { fieldError } from "@/components/campaigns/form-utils";
import { formatDate, formatDateTime } from "@/components/leads/lead-format";
import { SUBSCRIPTION_STATUS_LABELS } from "@/components/admin/org-format";
import { clearOrgEntitlementOverride, setOrgEntitlementOverride } from "@/lib/actions/admin/entitlements";
import type { OrgPolicyView } from "@/lib/queries/admin/org-policy";
import { draftToPayload, formatLimit, overrideToDraft, type FeatureMode, type LimitMode, type OverrideDraft } from "./policy-format";
import { FormError, ReasonField, Section, useAdminAction } from "./policy-ui";

const SOURCE_LABEL: Record<string, string> = {
  plan: "Plano",
  full: "Acesso total (Business/Cortesia)",
  none: "Sem assinatura (acesso livre)",
  blocked: "Bloqueada (só leitura)",
  unknown_plan: "Plano ilegível (fechado por segurança)",
  error: "Erro ao ler o plano (fechado por segurança)",
};

const selectCls = "h-11 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 sm:h-9";

/** SPEC-069c — aba "Plano e features": plano atual, efetivo (plano + override) e formulário de override com motivo e validade opcional. */
export function PlanOverrideTab({ policy }: { policy: OrgPolicyView }) {
  const eff = policy.effective;
  const [clearOpen, setClearOpen] = React.useState(false);
  return (
    <div className="space-y-4">
      <Section title="Plano atual" description="O que vale hoje para esta organização: plano mais o override ativo. Override nunca destrava bloqueio de pagamento.">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Plano</dt>
            <dd className="font-medium">{policy.plan.name ?? "Sem plano"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Assinatura</dt>
            <dd>{policy.plan.subscriptionStatus ? SUBSCRIPTION_STATUS_LABELS[policy.plan.subscriptionStatus] : "Sem assinatura"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Origem do efetivo</dt>
            <dd>{SOURCE_LABEL[eff.source] ?? eff.source}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Override</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              {eff.overrideActive ? <Badge>Ativo{eff.overrideExpiresAt ? ` até ${formatDate(new Date(eff.overrideExpiresAt))}` : " sem prazo"}</Badge> : policy.override ? <Badge variant="destructive">Expirado</Badge> : <Badge variant="muted">Nenhum</Badge>}
              {eff.paused ? <Badge variant="destructive">IA e envio pausados (pagamento)</Badge> : null}
            </dd>
          </div>
        </dl>
        {policy.override ? (
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="min-w-0 break-words">
              <span className="text-xs text-muted-foreground">Motivo do override (atualizado em {formatDateTime(new Date(policy.override.updatedAt))})</span>
              <br />
              {policy.override.reason}
            </p>
            <Button type="button" variant="outline" className="h-11 w-full sm:h-9 sm:w-auto" onClick={() => setClearOpen(true)}>
              Remover override
            </Button>
          </div>
        ) : null}
      </Section>

      <OverrideForm key={policy.override?.updatedAt ?? "none"} policy={policy} />

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Remover override</DialogTitle>
            <DialogDescription>A organização volta a valer só pelo plano.</DialogDescription>
          </DialogHeader>
          <ClearForm orgId={policy.org.id} onDone={() => setClearOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OverrideForm({ policy }: { policy: OrgPolicyView }) {
  const uid = React.useId();
  const [draft, setDraft] = React.useState<OverrideDraft>(() => overrideToDraft(policy));
  const { run, errors, pending } = useAdminAction();
  const eff = policy.effective;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(() => setOrgEntitlementOverride(draftToPayload(policy.org.id, draft)), "Override gravado.", () => setDraft((d) => ({ ...d, reason: "" })));
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Section
        title="Override por funcionalidade"
        description="“Seguir plano” não altera nada. “Liberar” e “Bloquear” sobrepõem o plano (também é possível restringir). Mostramos o efetivo atual ao lado."
      >
        <div className="divide-y divide-border">
          {policy.catalog.features.map((f) => {
            const id = `${uid}-f-${f.key}`;
            const on = eff.features[f.key as keyof typeof eff.features] === true;
            return (
              <div key={f.key} className="grid gap-2 py-2.5 sm:grid-cols-[1fr_11rem] sm:items-center">
                <label htmlFor={id} className="min-w-0 text-sm">
                  <span className="font-medium">{f.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">Efetivo: {on ? "liberado" : "bloqueado"}</span>
                </label>
                <select id={id} className={selectCls} value={draft.features[f.key]} onChange={(e) => setDraft((d) => ({ ...d, features: { ...d.features, [f.key]: e.target.value as FeatureMode } }))}>
                  <option value="plan">Seguir plano</option>
                  <option value="on">Liberar</option>
                  <option value="off">Bloquear</option>
                </select>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Override por limite" description="Vazio em “Seguir plano”. “Ilimitado” remove o teto; “Valor” define um número inteiro (0 bloqueia).">
        <div className="divide-y divide-border">
          {policy.catalog.limits.map((l) => {
            const id = `${uid}-l-${l.key}`;
            const cur = draft.limits[l.key];
            const eV = eff.limits[l.key as keyof typeof eff.limits];
            return (
              <div key={l.key} className="grid gap-2 py-2.5 sm:grid-cols-[1fr_11rem_8rem] sm:items-center">
                <label htmlFor={id} className="min-w-0 text-sm">
                  <span className="font-medium">{l.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">Efetivo: {formatLimit(eV)}</span>
                </label>
                <select id={id} className={selectCls} value={cur.mode} onChange={(e) => setDraft((d) => ({ ...d, limits: { ...d.limits, [l.key]: { ...cur, mode: e.target.value as LimitMode } } }))}>
                  <option value="plan">Seguir plano</option>
                  <option value="value">Valor</option>
                  <option value="unlimited">Ilimitado</option>
                </select>
                <Input
                  aria-label={`Valor para ${l.label}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={cur.value}
                  disabled={cur.mode !== "value"}
                  aria-invalid={Boolean(fieldError(errors, `limits.${l.key}`))}
                  onChange={(e) => setDraft((d) => ({ ...d, limits: { ...d.limits, [l.key]: { ...cur, value: e.target.value } } }))}
                  className="h-11 sm:h-9"
                />
                {fieldError(errors, `limits.${l.key}`) ? (
                  <p role="alert" className="text-xs text-destructive sm:col-span-3">
                    {fieldError(errors, `limits.${l.key}`)}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Validade e motivo" description="Para clientes-piloto, defina até quando o override vale. Vazio = sem prazo.">
        <div className="grid gap-4">
          <FormError errors={errors} />
          <div className="max-w-xs">
            <Field id={`${uid}-exp`} label="Válido até (opcional)" error={fieldError(errors, "expiresAt")} hint="Data futura; vale até o fim desse dia (UTC).">
              {(a) => <Input {...a} type="date" value={draft.expiresAt} onChange={(e) => setDraft((d) => ({ ...d, expiresAt: e.target.value }))} className="h-11 sm:h-9" />}
            </Field>
          </div>
          <ReasonField id={`${uid}-reason`} value={draft.reason} onChange={(v) => setDraft((d) => ({ ...d, reason: v }))} error={fieldError(errors, "reason")} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending} className="h-11 w-full sm:h-9 sm:w-auto">
              {pending ? "Gravando…" : "Gravar override"}
            </Button>
          </div>
        </div>
      </Section>
    </form>
  );
}

function ClearForm({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const uid = React.useId();
  const [reason, setReason] = React.useState("");
  const { run, errors, pending } = useAdminAction();
  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(() => clearOrgEntitlementOverride({ orgId, reason }), "Override removido.", onDone);
  }
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <FormError errors={errors} />
      <ReasonField id={`${uid}-reason`} value={reason} onChange={setReason} error={fieldError(errors, "reason")} />
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" className="h-11 sm:h-9" />}>Cancelar</DialogClose>
        <Button type="submit" variant="destructive" disabled={pending} className="h-11 sm:h-9">
          {pending ? "Removendo…" : "Remover override"}
        </Button>
      </DialogFooter>
    </form>
  );
}
