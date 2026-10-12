import Link from "next/link";
import { Building2 } from "lucide-react";
import { loadAccountStage } from "@/lib/auth/account-stage";
import type { PlatformRole } from "@/lib/auth/session-token";

/**
 * SPEC-062b (D-062-19) — "Finalize sua organização": quem já tem uma organização no app e também tem um plano PAGO sem
 * organização nomeada (casca paga) vê esta faixa no layout. Nunca derruba o layout (erro => sem faixa).
 */
export async function PendingSetupBanner({ userId, platformRole }: { userId: string; platformRole: PlatformRole }) {
  let pending = false;
  try {
    pending = (await loadAccountStage(userId, platformRole)).pendingSetup;
  } catch {
    return null;
  }
  if (!pending) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-primary/30 bg-primary/10 px-4 py-2 text-sm md:px-6">
      <Building2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <strong className="font-semibold">Finalize sua organização.</strong> Seu plano já está pago; falta dar um nome para a nova organização.
      </p>
      <Link href="/organizacao/nova" className="rounded-sm font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40">
        Finalizar agora
      </Link>
    </div>
  );
}
