import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { IcpManager } from "@/components/campaigns/IcpManager";
import { listIcps } from "@/lib/queries/campaigns";
import { redirectIfTrialExpired } from "@/lib/auth/require-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  await redirectIfTrialExpired(); // SPEC-065 (D-065-13.3): trial expirado => redirect a /configuracoes/assinatura
  const icps = await listIcps();
  return (
    <div className="space-y-4">
      <Link href="/campanhas" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Voltar para campanhas
      </Link>
      <h2 className="font-heading text-xl font-semibold">Perfis de cliente ideal (ICPs)</h2>
      <IcpManager icps={icps} />
    </div>
  );
}
