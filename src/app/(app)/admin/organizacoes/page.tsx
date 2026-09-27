import { redirect } from "next/navigation";
import { CreateCourtesyOrgDialog } from "@/components/admin/CreateCourtesyOrgDialog";
import { OrganizationsList } from "@/components/admin/OrganizationsList";
import { OrganizationsSearchForm } from "@/components/admin/OrganizationsSearchForm";
import type { RawParams } from "@/components/admin/org-format";
import { ForbiddenError } from "@/lib/auth/require-admin";
import { UnauthorizedError } from "@/lib/auth/require-user";
import { listOrganizations } from "@/lib/queries/admin/organizations";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
};

function parsePage(v: string | string[] | undefined): number {
  const n = Number(one(v));
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

/**
 * SPEC-032 — lista cross-tenant de Organizations, `platform_admin` apenas. `listOrganizations()` já
 * chama `requirePlatformAdmin()` internamente; `provider` NUNCA renderiza esta página (redireciona
 * antes de qualquer dado ser buscado/exibido — não é só o link escondido na sidebar).
 */
export default async function Page({ searchParams }: { searchParams: Promise<RawParams> }) {
  const raw = await searchParams;
  const input = { page: parsePage(raw.page), search: one(raw.q), status: one(raw.status) };
  let data;
  try {
    data = await listOrganizations(input);
  } catch (e) {
    if (e instanceof ForbiddenError) redirect("/dashboard");
    if (e instanceof UnauthorizedError) redirect("/login");
    throw e;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="font-heading text-lg font-semibold">Administração</h2>
          <p className="text-sm text-muted-foreground">Todas as organizações da plataforma — visão cross-tenant, apenas para administradores da plataforma.</p>
        </div>
        <CreateCourtesyOrgDialog />
      </div>
      <OrganizationsSearchForm params={raw} />
      <OrganizationsList {...data} params={raw} />
    </div>
  );
}
