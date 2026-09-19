"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// Em produção o Next sanitiza erros de Server Components (só `digest`), então a detecção
// por nome/mensagem funciona em dev; em produção o layout (redirect) cobre o caso comum
// e o link "Entrar novamente" cobre o restante.
const isUnauthorized = (e: Error) => e.name === "UnauthorizedError" || e.message.includes("Não autenticado.");

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const router = useRouter();
  const unauthorized = isUnauthorized(error);
  React.useEffect(() => {
    if (unauthorized) router.replace("/login");
  }, [unauthorized, router]);
  if (unauthorized) return null;
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
      <h2 className="font-heading text-xl font-semibold">Algo deu errado</h2>
      <p className="text-sm text-muted-foreground">Não foi possível carregar esta página.</p>
      <div className="flex gap-2">
        <Button onClick={() => retry()}>Tentar novamente</Button>
        <Link href="/login" className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent">
          Entrar novamente
        </Link>
      </div>
    </div>
  );
}
