import type { Metadata } from "next";
import { InviteLanding, type InviteViewState } from "@/components/org/InviteLanding";
import { requireUser, UnauthorizedError } from "@/lib/auth/require-user";
import { previewInvite } from "@/lib/actions/org";
import { getFormError } from "@/components/campaigns/form-utils";

export const metadata: Metadata = {
  title: "Convite | LeadForge",
  robots: { index: false, follow: false },
  // O token vai na URL: não vaza em Referer para recursos/links externos.
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

/**
 * SPEC-049b — página PÚBLICA do convite (liberada em `src/proxy.ts`). `previewInvite` (rate limit por IP, resposta
 * genérica para inválido) + sessão decidem o estado; a página nunca distingue por que um convite é inválido (D-049-8).
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  let token = raw;
  try {
    token = decodeURIComponent(raw);
  } catch {
    /* mantém o valor bruto */
  }

  const preview = await previewInvite({ token });
  let state: InviteViewState;
  if (!preview.ok) {
    state = { kind: "error", message: getFormError(preview.errors, "Não foi possível abrir o convite agora. Tente novamente em instantes.") };
  } else if (!preview.data.valid) {
    state = { kind: "invalid" };
  } else {
    const { orgName, email, orgRole, userExists } = preview.data;
    let current: { email: string; platformRole: string } | null = null;
    try {
      const u = await requireUser();
      current = { email: u.email, platformRole: u.platformRole };
    } catch (e) {
      if (!(e instanceof UnauthorizedError)) throw e;
    }
    if (current) {
      state =
        current.platformRole === "provider" && current.email.toLowerCase() === email.toLowerCase()
          ? { kind: "accept", orgName, email, orgRole }
          : { kind: "wrong-account", orgName, inviteEmail: email, currentEmail: current.email };
    } else {
      state = userExists ? { kind: "login", orgName, email, orgRole } : { kind: "signup", orgName, email, orgRole };
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-6 shadow-xl sm:p-8">
        <div className="space-y-1 text-center">
          <p className="font-heading text-2xl font-bold text-primary">LeadForge</p>
          <h1 className="font-heading text-lg font-semibold">Convite para uma organização</h1>
        </div>
        <InviteLanding token={token} state={state} />
      </div>
    </main>
  );
}
