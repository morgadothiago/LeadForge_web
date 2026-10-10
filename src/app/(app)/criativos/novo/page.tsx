import Link from "next/link";
import { Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { CreativeWizard } from "@/components/creatives/CreativeWizard";
import { getFormError } from "@/components/campaigns/form-utils";
import { listAvatarsAndVoices } from "@/lib/actions/creative";

export const dynamic = "force-dynamic";

/** SPEC-051b — criação de criativo em passos. */
export default async function NovoCriativoPage() {
  const res = await listAvatarsAndVoices();
  if (!res.ok) {
    return (
      <Card role="alert" className="mx-auto flex max-w-xl flex-col items-center gap-2 p-10 text-center">
        <Lock aria-hidden="true" className="size-8 text-muted-foreground" />
        <p className="font-heading text-lg font-semibold">Não foi possível abrir o formulário</p>
        <p className="text-sm text-muted-foreground">{getFormError(res.errors)}</p>
        <Link href="/criativos" className={buttonVariants({ variant: "outline", className: "mt-2" })}>
          Voltar para a biblioteca
        </Link>
      </Card>
    );
  }
  return <CreativeWizard info={res.data} />;
}
