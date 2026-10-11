import type { Metadata } from "next";
import { VerifyEmailResult } from "@/components/auth/VerifyEmailResult";

export const metadata: Metadata = {
  title: "Confirmar e-mail | LeadForge",
  robots: { index: false, follow: false },
  // O token vai na URL: nao vaza em Referer.
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

/** SPEC-055b — pagina PUBLICA (liberada em `src/proxy.ts`): o link pode ser aberto sem sessao. */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token: raw } = await searchParams;
  const token = Array.isArray(raw) ? raw[0] : raw;
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-6 shadow-xl sm:p-8">
        <div className="space-y-1 text-center">
          <p className="font-heading text-2xl font-bold text-primary">LeadForge</p>
          <h1 className="font-heading text-lg font-semibold">Confirmar e-mail</h1>
        </div>
        <VerifyEmailResult token={token} />
      </div>
    </main>
  );
}
