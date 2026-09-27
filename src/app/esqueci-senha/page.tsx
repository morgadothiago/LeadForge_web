import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Esqueci minha senha | LeadForge",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-6 shadow-xl sm:p-8">
        <div className="space-y-1 text-center">
          <p className="font-heading text-2xl font-bold text-primary">LeadForge</p>
          <h1 className="font-heading text-lg font-semibold">Esqueceu sua senha?</h1>
          <p className="text-sm text-muted-foreground">Informe seu e-mail e enviaremos um link para redefinir a senha.</p>
        </div>
        <ForgotPasswordForm />
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
