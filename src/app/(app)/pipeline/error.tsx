"use client";
import { Button } from "@/components/ui/button";

export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
      <h2 className="font-heading text-xl font-semibold">Algo deu errado</h2>
      <p className="text-sm text-muted-foreground">Não foi possível carregar esta página.</p>
      <Button onClick={() => retry()}>Tentar novamente</Button>
    </div>
  );
}
