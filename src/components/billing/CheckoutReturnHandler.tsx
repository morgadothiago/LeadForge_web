"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

/**
 * SPEC-034 — trata o retorno do checkout hospedado (`?checkout=success|cancel`, URLs configuradas em
 * `createCheckoutSession`, `src/lib/actions/billing.ts`): toast + limpa o parâmetro da URL + revalida
 * a página (o status da org/assinatura pode ter mudado). Não renderiza nada.
 */
export function CheckoutReturnHandler() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const checkout = searchParams.get("checkout");

  React.useEffect(() => {
    if (checkout === "success") {
      toast.success("Assinatura confirmada. Seu plano já está ativo.");
    } else if (checkout === "cancel") {
      toast.info("Checkout cancelado. Nenhuma cobrança foi feita.");
    } else {
      return;
    }
    router.replace(pathname);
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reagir só ao parâmetro; pathname/router mudam a cada navegação
  }, [checkout]);

  return null;
}
