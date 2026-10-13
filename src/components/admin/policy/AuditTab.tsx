import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/components/leads/lead-format";
import type { OrgPolicyView } from "@/lib/queries/admin/org-policy";
import { AUDIT_ACTION_LABELS, AUDIT_AREA_LABELS, auditFields } from "./policy-format";
import { Section } from "./policy-ui";

/** SPEC-069c — aba "Auditoria": últimas 50 mudanças de política (quem/quando/motivo/campos). Nunca contém valor de segredo. */
export function AuditTab({ audit }: { audit: OrgPolicyView["audit"] }) {
  return (
    <Section title="Auditoria de política" description="Últimas 50 alterações feitas pelo admin nesta organização.">
      {audit.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">Nenhuma alteração registrada ainda.</p>
      ) : (
        <ol className="divide-y divide-border">
          {audit.map((a) => {
            const fields = auditFields(a.meta);
            const area = a.meta && typeof a.meta === "object" ? (a.meta as { area?: unknown }).area : undefined;
            return (
              <li key={a.id} className="grid gap-1 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{AUDIT_ACTION_LABELS[a.action] ?? a.action}</span>
                  {typeof area === "string" ? <Badge variant="muted">{AUDIT_AREA_LABELS[area] ?? area}</Badge> : null}
                  <time dateTime={a.at} className="text-xs text-muted-foreground">
                    {formatDateTime(new Date(a.at))}
                  </time>
                </div>
                {a.reason ? <p className="break-words text-muted-foreground">Motivo: {a.reason}</p> : null}
                {fields.length ? <p className="break-words text-xs text-muted-foreground">Campos: {fields.join(", ")}</p> : null}
                <p className="text-xs text-muted-foreground">Admin: <span className="font-mono">{a.adminUserId.slice(0, 8)}</span></p>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
