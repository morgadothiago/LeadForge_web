import { Card } from "@/components/ui/card";
import { Lock } from "lucide-react";
import { MyOrganizations } from "@/components/org/MyOrganizations";
import { listMyOrganizations } from "@/lib/actions/org";
import { listActivePlans } from "@/lib/billing/plans";
import { getFormError } from "@/components/campaigns/form-utils";

export const dynamic = "force-dynamic";

/** SPEC-049b — "Minhas organizações" (provider). platform_admin não tem org: a action recusa e a página explica. */
export default async function OrganizacoesPage() {
  const [res, plans] = await Promise.all([listMyOrganizations(), listActivePlans()]);
  if (!res.ok) {
    return (
      <Card role="alert" className="flex flex-col items-center gap-2 p-10 text-center">
        <Lock aria-hidden="true" className="size-8 text-muted-foreground" />
        <p className="font-heading text-lg font-semibold">Não foi possível carregar suas organizações</p>
        <p className="text-sm text-muted-foreground">{getFormError(res.errors, "Esta área é exclusiva de contas Provider com organização.")}</p>
      </Card>
    );
  }
  const selfService = plans.filter((p) => p.selfServiceCheckout).map((p) => ({ key: p.key, name: p.name, priceMonthlyCents: p.priceMonthlyCents }));
  return <MyOrganizations organizations={res.data.organizations} plans={selfService} />;
}
