import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="font-heading text-3xl font-bold text-primary">404</h1>
      <p className="text-sm text-muted-foreground">Página não encontrada.</p>
      <Link href="/" className={buttonVariants()}>Voltar ao Dashboard</Link>
    </main>
  );
}
