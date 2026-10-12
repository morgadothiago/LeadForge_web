import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { JoinByCodeForm } from "@/components/onboarding/JoinByCodeForm";
import { requireStageRoute } from "@/lib/auth/stage-guard";

export const metadata: Metadata = { title: "Entrar em uma organização | LeadForge", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** SPEC-062b (D-062-15) — código de entrada digitado logado. Qualquer provider (admin vai à própria área). Entra sem checkout. */
export default async function EntrarEmOrganizacaoPage() {
  const { stage } = await requireStageRoute("/entrar-em-organizacao");
  const back = stage === "dono" || stage === "membro" ? { href: "/organizacoes", label: "Voltar às minhas organizações" } : { href: "/assinar", label: "Escolher um plano em vez disso" };
  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <Card className="space-y-6 p-6 sm:p-8">
        <div className="space-y-2 text-center">
          <h1 className="font-heading text-2xl font-bold tracking-tight">Entrar em uma organização</h1>
          <p className="text-sm text-muted-foreground">Digite o código que a organização compartilhou com você. Você entra sem pagar: quem paga o plano é a organização.</p>
        </div>
        <JoinByCodeForm />
        <p className="text-xs text-muted-foreground">
          Recebeu um convite por e-mail? Abra o link do e-mail com a mesma conta (mesmo e-mail do convite) para aceitar.
        </p>
      </Card>
      <p className="text-center text-sm">
        <Link href={back.href} className="font-medium text-primary underline-offset-2 hover:underline">
          {back.label}
        </Link>
      </p>
    </div>
  );
}
