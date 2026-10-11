import { Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DeleteAccountPanel } from "@/components/account/DeleteAccountPanel";
import { getAccountDeletionState } from "@/lib/actions/account-deletion";
import { getFormError } from "@/components/campaigns/form-utils";

export const dynamic = "force-dynamic";

/** SPEC-054b — Configuracoes > Conta: exclusao de conta (LGPD). Qualquer papel de provider; o estado vem de `getAccountDeletionState`. */
export default async function ContaPage() {
  const res = await getAccountDeletionState();
  if (!res.ok) {
    return (
      <Card role="alert" className="flex flex-col items-center gap-2 p-10 text-center">
        <Lock className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-heading text-lg font-semibold">Não foi possível abrir esta área</p>
        <p className="text-sm text-muted-foreground">{getFormError(res.errors, "Tente novamente em instantes.")}</p>
      </Card>
    );
  }
  return <DeleteAccountPanel state={res.data} />;
}
