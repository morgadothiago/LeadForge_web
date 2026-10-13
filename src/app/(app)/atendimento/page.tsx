import { InboxShell } from "@/components/inbox/InboxShell";
import { redirectIfTrialExpired, requirePageUser } from "@/lib/auth/require-page";
import { getTenantEntitlements } from "@/lib/queries/entitlements";
import type { LockReason } from "@/components/billing/FeatureLockNotice";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SPEC-068b: caixa de atendimento de WhatsApp. Trial expirado => redirect (065); `?c=<uuid>` abre a conversa (link direto). `platform_admin` (sem org) ve um aviso, nao a pagina de erro. */
export default async function Page({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  await redirectIfTrialExpired();
  const user = await requirePageUser();
  if (user.platformRole !== "provider" || !user.orgId) {
    return (
      <div role="note" className="mx-auto max-w-md rounded-lg border border-border bg-card p-6 text-center">
        <h2 className="text-base font-semibold text-foreground">Caixa de atendimento indisponível</h2>
        <p className="mt-2 text-sm text-muted-foreground">A caixa de atendimento é das organizações clientes. Contas de administração da plataforma não têm acesso às conversas.</p>
      </div>
    );
  }
  const raw = (await searchParams).c;
  const c = Array.isArray(raw) ? raw[0] : raw;
  // SPEC-069d: Free le, Starter responde texto; `past_due`/assinatura inativa nao respondem pelo plano.
  const ent = await getTenantEntitlements().catch(() => null);
  const replyLock: LockReason | null = ent && !ent.features["inbox.reply"] ? (ent.paused ? "past_due" : ent.source === "blocked" ? "blocked" : "plan") : null;
  return <InboxShell initialConversationId={c && UUID_RE.test(c) ? c.toLowerCase() : null} replyLock={replyLock} />;
}
