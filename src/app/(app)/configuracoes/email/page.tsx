import { Info, Mail } from "lucide-react";
import { EmailAccountFormDialog } from "@/components/settings/EmailAccountFormDialog";
import { EmailAccountList } from "@/components/settings/EmailAccountList";
import { Card } from "@/components/ui/card";
import { listEmailAccounts } from "@/lib/queries/email";
import { redirectIfTrialExpired } from "@/lib/auth/require-page";
import { getPlanUsage } from "@/lib/queries/usage";
import { LimitNotice, limitNoticeId } from "@/components/billing/LimitNotice";
import { isAtLimit } from "@/components/billing/trial-ui";

export const dynamic = "force-dynamic";

export default async function Page() {
  await redirectIfTrialExpired(); // SPEC-065 (D-065-13.3): trial expirado => redirect a /configuracoes/assinatura
  const [accounts, usage] = await Promise.all([listEmailAccounts(), getPlanUsage().catch(() => null)]);
  const full = usage ? isAtLimit(usage.byMetric.email_accounts) : false;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">Contas de e-mail</h2>
          <p className="text-sm text-muted-foreground">Contas SMTP usadas para enviar as mensagens das sequências.</p>
        </div>
        <EmailAccountFormDialog mode="create" createDisabled={full} createDescribedBy={limitNoticeId("email_accounts")} />
      </div>
      <LimitNotice item={usage?.byMetric.email_accounts} />

      <div role="note" className="flex gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          Todo e-mail enviado inclui link de descadastro (LGPD); quem se descadastra deixa de receber mensagens. Respostas por e-mail ainda não
          pausam a sequência automaticamente — por enquanto, apenas respostas via WhatsApp fazem isso.
        </p>
      </div>

      {accounts.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <Mail className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-heading text-lg font-semibold">Nenhuma conta de e-mail</p>
          <p className="text-sm text-muted-foreground">Adicione uma conta para poder enviar e-mails nas sequências.</p>
        </Card>
      ) : (
        <EmailAccountList accounts={accounts} />
      )}
    </div>
  );
}
