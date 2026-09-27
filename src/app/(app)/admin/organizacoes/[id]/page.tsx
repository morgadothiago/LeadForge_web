import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { OrganizationStatusActions } from "@/components/admin/OrganizationStatusActions";
import { OrgStatusBadge } from "@/components/admin/OrgStatusBadge";
import { SUBSCRIPTION_STATUS_LABELS } from "@/components/admin/org-format";
import { formatDate, formatDateTime, relativeTime } from "@/components/leads/lead-format";
import { Card } from "@/components/ui/card";
import { ForbiddenError } from "@/lib/auth/require-admin";
import { UnauthorizedError } from "@/lib/auth/require-user";
import { getOrganizationDetail } from "@/lib/queries/admin/organizations";
import { orgIdSchema } from "@/lib/schemas/admin";

export const dynamic = "force-dynamic";

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}

/**
 * SPEC-032 — detalhe cross-tenant de 1 Organization, `platform_admin` apenas. `getOrganizationDetail()`
 * já chama `requirePlatformAdmin()` internamente; `provider` NUNCA renderiza esta página, mesmo
 * digitando a URL direto — o guard é no servidor (query), não um esconde-mostra de UI.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!orgIdSchema.safeParse(id).success) notFound();

  let org;
  try {
    org = await getOrganizationDetail(id);
  } catch (e) {
    if (e instanceof ForbiddenError) redirect("/dashboard");
    if (e instanceof UnauthorizedError) redirect("/login");
    throw e;
  }
  if (!org) notFound();

  return (
    <div className="space-y-6">
      <Link href="/admin/organizacoes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" /> Administração
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words font-heading text-xl font-semibold">{org.name}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <OrgStatusBadge status={org.status} />
            <span>{org.slug}</span>
          </p>
        </div>
        <OrganizationStatusActions orgId={org.id} orgName={org.name} status={org.status} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Campanhas ativas" value={org.activeCampaigns} />
        <StatCard label="Leads" value={org.totalLeads} />
        <StatCard label="WhatsApp conectados" value={org.connectedWhatsapp} />
      </div>

      <Card className="p-5">
        <h3 className="mb-4 font-heading text-base font-semibold">Ficha</h3>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Dono</dt>
            <dd className="text-sm">{org.ownerName ? `${org.ownerName} (${org.ownerEmail})` : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Assinatura</dt>
            <dd className="text-sm">{org.subscriptionStatus ? SUBSCRIPTION_STATUS_LABELS[org.subscriptionStatus] : "Sem assinatura"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Última atividade</dt>
            <dd className="text-sm">
              {org.lastActivityAt ? (
                <time dateTime={org.lastActivityAt.toISOString()} title={formatDateTime(org.lastActivityAt)}>
                  {relativeTime(org.lastActivityAt)}
                </time>
              ) : (
                "Nunca"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Criada em</dt>
            <dd className="text-sm">
              <time dateTime={org.createdAt.toISOString()}>{formatDate(org.createdAt)}</time>
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
