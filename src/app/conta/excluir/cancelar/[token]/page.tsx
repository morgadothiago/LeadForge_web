import type { Metadata } from "next";
import { DeletionTokenLanding } from "@/components/account/DeletionTokenLanding";
import { loadDeletionLandingState } from "@/components/account/deletion-landing-state";

export const metadata: Metadata = {
  title: "Cancelar exclusão | LeadForge",
  robots: { index: false, follow: false },
  // O token vai na URL: nao vaza em Referer.
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

/** SPEC-054b — pagina PUBLICA (liberada em `src/proxy.ts`); abrir o link so mostra o preview, a acao exige clique. */
export default async function CancelDeletionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const { token, state } = await loadDeletionLandingState(raw, "cancel");
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-6 shadow-xl sm:p-8">
        <div className="space-y-1 text-center">
          <p className="font-heading text-2xl font-bold text-primary">LeadForge</p>
          <h1 className="font-heading text-lg font-semibold">Cancelar exclusão da conta</h1>
        </div>
        <DeletionTokenLanding token={token} state={state} />
      </div>
    </main>
  );
}
