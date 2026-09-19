import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { listUnreadInstanceAlerts } from "@/lib/queries/whatsapp-health";

/** Faixa discreta: alertas não lidos de saúde/pausa de instâncias de WhatsApp. Falha de consulta nunca derruba o layout. */
export async function HealthBanner() {
  let names: string[] = [];
  let count = 0;
  try {
    const alerts = await listUnreadInstanceAlerts();
    count = alerts.length;
    names = [...new Set(alerts.map((a) => a.instanceName))];
  } catch {
    return null;
  }
  if (count === 0) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm md:px-6">
      <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        {count} alerta{count === 1 ? "" : "s"} de saúde do WhatsApp em {names.join(", ")}. Envios podem estar pausados.
      </p>
      <Link href="/configuracoes/whatsapp" className="rounded-sm font-medium text-warning underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40">
        Ver saúde
      </Link>
    </div>
  );
}
