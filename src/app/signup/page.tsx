import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/SignupForm";
import { listActivePlans } from "@/lib/billing/plans";
import { requireUser, UnauthorizedError, homeRouteFor } from "@/lib/auth/require-user";
import type { BillingCadence } from "@prisma/client";

export const metadata: Metadata = {
  title: "Criar conta | LeadForge",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

function resolveCadence(v: string | string[] | undefined): BillingCadence {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw === "yearly" ? "yearly" : "monthly";
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let homeRoute: string | null = null;
  try {
    const user = await requireUser();
    homeRoute = homeRouteFor(user.platformRole);
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
  }
  if (homeRoute) redirect(homeRoute);

  const sp = await searchParams;
  const requestedPlanRaw = Array.isArray(sp.plan) ? sp.plan[0] : sp.plan;
  const cadence = resolveCadence(sp.cadence);

  const plans = await listActivePlans();
  const selfServicePlans = plans.filter((p) => p.selfServiceCheckout);
  const requested = requestedPlanRaw ? selfServicePlans.find((p) => p.key === requestedPlanRaw) : undefined;
  // D-33-2: "starter" é o plano de entrada self-service; se o param veio ausente/inválido/de um plano sem
  // checkout self-service (ex. "business"), cai para o mais barato disponível — nunca bloqueia o cadastro.
  const plan = requested ?? selfServicePlans[0];

  if (!plan) {
    // Nenhum plano self-service ativo (catálogo mal configurado) — não é um erro de usuário; sem plano não há como iniciar o trial.
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-10">
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          Nenhum plano disponível para cadastro no momento. Tente novamente mais tarde ou entre em contato com o suporte.
        </p>
      </main>
    );
  }

  const price = cadence === "monthly" ? plan.priceMonthlyCents : plan.priceYearlyCents;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-6 shadow-xl sm:p-8">
        <div className="space-y-1 text-center">
          <p className="font-heading text-2xl font-bold text-primary">LeadForge</p>
          <h1 className="font-heading text-lg font-semibold">Criar sua conta</h1>
          <p className="text-sm text-muted-foreground">Comece a prospectar em minutos.</p>
        </div>
        <SignupForm planKey={plan.key} planName={plan.name} planPriceCents={price} cadence={cadence} intentCheckout={Boolean(requested)} />
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
