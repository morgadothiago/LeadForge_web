import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { CreativeDetail } from "@/components/creatives/CreativeDetail";
import { getFormError } from "@/components/campaigns/form-utils";
import { getCreative, listAvatarsAndVoices } from "@/lib/actions/creative";
import { redirectIfTrialExpired } from "@/lib/auth/require-page";

export const dynamic = "force-dynamic";

/** SPEC-051b — página do criativo (status, player, ações). */
export default async function CriativoPage({ params }: { params: Promise<{ id: string }> }) {
  await redirectIfTrialExpired(); // SPEC-065 (D-065-13.3): trial expirado => redirect a /configuracoes/assinatura
  const { id } = await params;
  const [res, info] = await Promise.all([getCreative(id), listAvatarsAndVoices()]);
  if (!res.ok) {
    return (
      <Card role="alert" className="mx-auto flex max-w-xl flex-col items-center gap-2 p-10 text-center">
        <TriangleAlert aria-hidden="true" className="size-8 text-muted-foreground" />
        <p className="font-heading text-lg font-semibold">Não foi possível abrir o criativo</p>
        <p className="text-sm text-muted-foreground">{getFormError(res.errors)}</p>
        <Link href="/criativos" className={buttonVariants({ variant: "outline", className: "mt-2" })}>
          Voltar para a biblioteca
        </Link>
      </Card>
    );
  }
  return <CreativeDetail key={res.data.id} initial={res.data} info={info.ok ? info.data : null} />;
}
