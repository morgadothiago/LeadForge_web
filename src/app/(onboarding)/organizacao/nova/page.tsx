import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { CancelPendingSubscription } from "@/components/onboarding/CancelPendingSubscription";
import { OrganizationSetupForm } from "@/components/onboarding/OrganizationSetupForm";
import { requireStageRoute } from "@/lib/auth/stage-guard";

export const metadata: Metadata = { title: "Crie sua organização | LeadForge", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** SPEC-062b (D-062-13) — só quem tem plano pago e ainda não nomeou a organização (`pago_sem_org`/`membro_pago_sem_org`). */
export default async function NovaOrganizacaoPage() {
  await requireStageRoute("/organizacao/nova");
  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <Card className="space-y-6 p-6 sm:p-8">
        <div className="space-y-2 text-center">
          <h1 className="font-heading text-2xl font-bold tracking-tight">Dê um nome à sua organização</h1>
          <p className="text-sm text-muted-foreground">Seu plano já está pago. Falta só escolher o nome da organização para liberar o painel.</p>
        </div>
        <OrganizationSetupForm />
      </Card>
      <div className="flex justify-center">
        <CancelPendingSubscription />
      </div>
    </div>
  );
}
