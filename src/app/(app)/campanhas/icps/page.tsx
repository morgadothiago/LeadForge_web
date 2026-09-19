import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { IcpManager } from "@/components/campaigns/IcpManager";
import { listIcps } from "@/lib/queries/campaigns";

export const dynamic = "force-dynamic";

export default async function Page() {
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
