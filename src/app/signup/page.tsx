import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/SignupForm";
import { requireUser, UnauthorizedError } from "@/lib/auth/require-user";
import { resolveSessionHomeRoute } from "@/lib/auth/account-stage";

export const metadata: Metadata = {
  title: "Criar conta | LeadForge",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

function resolveCadence(v: string | string[] | undefined): "monthly" | "yearly" {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw === "yearly" ? "yearly" : "monthly";
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let homeRoute: string | null = null;
  try {
    const user = await requireUser();
    homeRoute = await resolveSessionHomeRoute(user);
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
  }
  if (homeRoute) redirect(homeRoute);

  // SPEC-062 (D-062-1/7): o cadastro so cria o usuario. `?plan=&cadence=` (landing) e apenas INTENCAO, repassada a `signUp`,
  // que valida o plano no servidor (invalido e ignorado). `?modo=participar` antigo (D-062-15) apenas abre `/signup`.
  const sp = await searchParams;
  const planRaw = Array.isArray(sp.plan) ? sp.plan[0] : sp.plan;
  const modoRaw = Array.isArray(sp.modo) ? sp.modo[0] : sp.modo;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-6 shadow-xl sm:p-8">
        <div className="space-y-1 text-center">
          <p className="font-heading text-2xl font-bold text-primary">LeadForge</p>
          <h1 className="font-heading text-lg font-semibold">Criar sua conta</h1>
          <p className="text-sm text-muted-foreground">Crie sua conta em um minuto. Você escolhe o plano no próximo passo.</p>
        </div>
        {modoRaw === "participar" && (
          <p role="note" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Vai entrar em uma organização que já existe? Crie sua conta e, no próximo passo, use o código ou o link de convite que você recebeu. Você não precisa pagar.
          </p>
        )}
        <SignupForm plan={planRaw} cadence={resolveCadence(sp.cadence)} />
        <p className="text-center text-xs text-muted-foreground">
          Já tem conta?{" "}
          <Link href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
