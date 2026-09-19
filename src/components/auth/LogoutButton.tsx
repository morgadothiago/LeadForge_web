"use client";
import { getFormError } from "@/components/campaigns/form-utils";
import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/actions/auth";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const onClick = () =>
    startTransition(async () => {
      const res = await logout();
      if (res.ok) router.replace(res.data.redirectTo);
      else toast.error(getFormError(res.errors, "Não foi possível sair. Tente novamente."));
    });
  return (
    <Button type="button" variant="ghost" size="sm" className={className} onClick={onClick} disabled={pending} aria-busy={pending}>
      <LogOut aria-hidden="true" />
      {pending ? "Saindo..." : "Sair"}
    </Button>
  );
}
