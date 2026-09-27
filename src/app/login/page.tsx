import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { requireUser, UnauthorizedError, homeRouteFor } from "@/lib/auth/require-user";

export const metadata: Metadata = {
  title: "Entrar | LeadForge",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  let homeRoute: string | null = null;
  try {
    const user = await requireUser();
    homeRoute = homeRouteFor(user.platformRole);
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
  }
  if (homeRoute) redirect(homeRoute);

  const { next } = await searchParams;
  const nextValue = Array.isArray(next) ? next[0] : next;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-6 shadow-xl sm:p-8">
        <div className="space-y-1 text-center">
          <p className="font-heading text-2xl font-bold text-primary">LeadForge</p>
          <h1 className="font-heading text-lg font-semibold">Entrar na sua conta</h1>
          <p className="text-sm text-muted-foreground">Use seu e-mail e senha para acessar.</p>
        </div>
        <LoginForm next={nextValue} />
        <p className="text-center text-xs text-muted-foreground">
          Ainda não tem conta?{" "}
          <Link href="/signup" className="font-medium text-primary underline-offset-2 hover:underline">
            Criar conta
          </Link>
        </p>
      </div>
    </main>
  );
}
