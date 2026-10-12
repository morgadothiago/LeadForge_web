import { Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { TeamPanel } from "@/components/org/TeamPanel";
import { getFormError } from "@/components/campaigns/form-utils";
import { listMembers } from "@/lib/actions/org";
import { redirectIfTrialExpired } from "@/lib/auth/require-page";

export const dynamic = "force-dynamic";

/** SPEC-049b — Configurações > Equipe. Qualquer membro vê a lista; só `owner` recebe/usa convites e código. */
export default async function EquipePage() {
  await redirectIfTrialExpired(); // SPEC-065 (D-065-13.3): trial expirado => redirect a /configuracoes/assinatura
  const res = await listMembers();
  if (!res.ok) {
    return (
      <Card role="alert" className="flex flex-col items-center gap-2 p-10 text-center">
        <Lock aria-hidden="true" className="size-8 text-muted-foreground" />
        <p className="font-heading text-lg font-semibold">Não foi possível carregar a equipe</p>
        <p className="text-sm text-muted-foreground">{getFormError(res.errors, "Esta área é exclusiva de contas Provider com organização.")}</p>
      </Card>
    );
  }
  return <TeamPanel team={res.data} />;
}
