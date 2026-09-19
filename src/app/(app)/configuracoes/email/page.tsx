import { Info, Mail } from "lucide-react";
import { EmailAccountFormDialog } from "@/components/settings/EmailAccountFormDialog";
import { EmailAccountList } from "@/components/settings/EmailAccountList";
import { Card } from "@/components/ui/card";
import { listEmailAccounts } from "@/lib/queries/email";

export const dynamic = "force-dynamic";

export default async function Page() {
  const accounts = await listEmailAccounts();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">Contas de e-mail</h2>
          <p className="text-sm text-muted-foreground">Contas SMTP usadas para enviar as mensagens das sequências.</p>
        </div>
        <EmailAccountFormDialog mode="create" />
      </div>

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
