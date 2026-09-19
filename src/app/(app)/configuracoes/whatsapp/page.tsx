import { AlertTriangle, MessageCircle } from "lucide-react";
import { WhatsAppCreateButton } from "@/components/settings/WhatsAppCreateButton";
import { WhatsAppInstanceList } from "@/components/settings/WhatsAppInstanceList";
import { Card } from "@/components/ui/card";
import { listWhatsAppInstances } from "@/lib/queries/whatsapp";
import { getInstanceHealth, type InstanceHealthView } from "@/lib/queries/whatsapp-health";

export const dynamic = "force-dynamic";

export default async function Page() {
  const instances = await listWhatsAppInstances();
  // Poucas instâncias por conta: 1 consulta de saúde por instância, em paralelo, com falha isolada (não derruba a página).
  const entries = await Promise.all(
    instances.map(async (i): Promise<[string, InstanceHealthView | null]> => {
      try {
        return [i.id, await getInstanceHealth(i.id)];
      } catch {
        return [i.id, null];
      }
    }),
  );
  const healths = Object.fromEntries(entries);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">Instâncias de WhatsApp</h2>
          <p className="text-sm text-muted-foreground">Números conectados via Evolution API para enviar mensagens e receber respostas.</p>
        </div>
        <WhatsAppCreateButton />
      </div>

      <div role="note" className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <p>
          A conexão usa Baileys (não oficial): o número pode ser banido pelo WhatsApp. Use chip dedicado, respeite o limite diário e evite mensagens em massa.
          Para receber respostas, o Evolution precisa alcançar a URL pública do sistema (<code>APP_BASE_URL</code>). Envios respeitam a janela de seg-sex, 9h às 12h e 14h às 17h (fuso do lead), a rampa de aquecimento, a lista de supressão e a LGPD. Não há garantia contra banimento.
        </p>
      </div>

      {instances.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <MessageCircle className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-heading text-lg font-semibold">Nenhuma instância de WhatsApp</p>
          <p className="text-sm text-muted-foreground">Crie uma instância e leia o QR code para poder enviar mensagens nas sequências.</p>
        </Card>
      ) : (
        <WhatsAppInstanceList instances={instances} healths={healths} />
      )}
    </div>
  );
}
