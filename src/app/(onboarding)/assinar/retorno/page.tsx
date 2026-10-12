import type { Metadata } from "next";
import { CheckoutReturn } from "@/components/onboarding/CheckoutReturn";
import { requireStageRoute } from "@/lib/auth/stage-guard";

export const metadata: Metadata = { title: "Confirmando pagamento | LeadForge", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * SPEC-062b (D-062-11) — retorno do checkout. Renderiza para `sem_plano`/`aguardando_pagamento`/`pago_sem_org` (e para quem já
 * tem organização e está pagando a 2ª: `dono`/`membro`/`membro_pago_sem_org`). `?checkout=success` NÃO é lido: quem decide é o
 * status da assinatura, consultado pelo componente.
 */
export default async function RetornoPage() {
  await requireStageRoute("/assinar/retorno");
  return <CheckoutReturn />;
}
