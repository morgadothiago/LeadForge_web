import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Redefinir senha | LeadForge",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token: rawToken } = await searchParams;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-6 shadow-xl sm:p-8">
        <div className="space-y-1 text-center">
          <p className="font-heading text-2xl font-bold text-primary">LeadForge</p>
          <h1 className="font-heading text-lg font-semibold">Redefinir senha</h1>
          <p className="text-sm text-muted-foreground">Escolha uma nova senha para sua conta.</p>
        </div>
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="space-y-4 text-center">
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Link de redefinição inválido. Solicite um novo link.
            </p>
            <Link href="/esqueci-senha" className="inline-block text-sm font-medium text-primary underline-offset-2 hover:underline">
              Solicitar novo link
            </Link>
          </div>
        )}
        <p className="text-center text-xs text-muted-foreground">
          Lembrou a senha?{" "}
          <Link href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
