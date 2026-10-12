import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DeleteAccountPanel } from "@/components/account/DeleteAccountPanel";
import { EmailVerificationNotice } from "@/components/onboarding/EmailVerificationNotice";
import { getFormError } from "@/components/campaigns/form-utils";
import { getAccountDeletionState } from "@/lib/actions/account-deletion";
import { requireStageRoute } from "@/lib/auth/stage-guard";

export const metadata: Metadata = { title: "Minha conta | LeadForge", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * SPEC-062b (D-062-21) — conta de quem ainda não tem organização: e-mail (verificação) e exclusão de conta (054, mesmo
 * componente de Configurações > Conta). Quem já tem organização usa `/configuracoes/conta`.
 */
export default async function MinhaContaPage() {
  const { user } = await requireStageRoute("/minha-conta");
  const deletion = await getAccountDeletionState();
  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-bold tracking-tight">Minha conta</h1>
        <p className="text-sm text-muted-foreground">{user.name}</p>
      </div>
      <section aria-labelledby="email-h" className="space-y-3">
        <h2 id="email-h" className="font-heading text-lg font-semibold">
          E-mail
        </h2>
        <EmailVerificationNotice email={user.email} verified={user.emailVerified} />
      </section>
      {deletion.ok ? (
        <DeleteAccountPanel state={deletion.data} />
      ) : (
        <Card role="alert" className="flex flex-col items-center gap-2 p-10 text-center">
          <Lock className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-heading text-lg font-semibold">Não foi possível abrir a exclusão de conta</p>
          <p className="text-sm text-muted-foreground">{getFormError(deletion.errors, "Tente novamente em instantes.")}</p>
        </Card>
      )}
    </div>
  );
}
