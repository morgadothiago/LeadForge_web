"use client";
import { getFormError } from "@/components/campaigns/form-utils";
import * as React from "react";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/actions/auth";
import { clearClientStorage } from "@/lib/auth/client-logout";

export function LogoutButton({ className }: { className?: string }) {
  const [pending, startTransition] = React.useTransition();
  const onClick = () =>
    startTransition(async () => {
      const res = await logout();
      if (res.ok) {
        clearClientStorage();
        // Navegação completa (não router.replace): evita o Next re-renderizar a página atual
        // (ex. /campanhas) com o cookie já removido antes de sair dela — cookies().delete() na
        // action invalida o cache de rota e dispara um refetch da rota corrente, que lançaria
        // UnauthorizedError sem sessão. Um reload total descarta a árvore antiga imediatamente.
        window.location.href = res.data.redirectTo;
      } else toast.error(getFormError(res.errors, "Não foi possível sair. Tente novamente."));
    });
  return (
    <Button type="button" variant="ghost" size="sm" className={className} onClick={onClick} disabled={pending} aria-busy={pending}>
      <LogOut aria-hidden="true" />
      {pending ? "Saindo..." : "Sair"}
    </Button>
  );
}
