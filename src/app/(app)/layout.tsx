import * as React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HealthBanner } from "@/components/layout/HealthBanner";
import { VerifyEmailBanner } from "@/components/auth/VerifyEmailBanner";
import { SubscriptionPendingBanner } from "@/components/billing/SubscriptionPendingBanner";
import { Header } from "@/components/layout/Header";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { parseSidebarDefaultOpen } from "@/lib/sidebar-state";
import { parseTheme, THEME_COOKIE_NAME } from "@/lib/theme-state";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";
import { getNotificationSummary } from "@/lib/notifications/summary";
import { EMPTY_SUMMARY } from "@/lib/notifications/client-types";
import { listActivePlans } from "@/lib/billing/plans";
import { listMyOrganizations } from "@/lib/actions/org";
import { requireUser, UnauthorizedError, type CurrentUser } from "@/lib/auth/require-user";
import { resolveSessionHomeRoute } from "@/lib/auth/account-stage";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  let user: CurrentUser;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect("/login");
    throw e;
  }
  // SPEC-062 (D-062-8): provider SEM organizacao na sessao nunca ve o tenant — vai ao destino do estado (`/assinar`,
  // `/organizacao/nova`...). Caso anomalo (tem org mas a sessao nao) => `/login`, que reemite a sessao (sem laco: o login nao redireciona nesse caso).
  if (user.platformRole === "provider" && !user.orgId) redirect((await resolveSessionHomeRoute(user)) ?? "/login");
  const cookieStore = await cookies();
  const defaultOpen = parseSidebarDefaultOpen(cookieStore.get("sidebar_state")?.value);
  const initialTheme = parseTheme(cookieStore.get(THEME_COOKIE_NAME)?.value);
  const summary = user.orgId ? await getNotificationSummary(user.orgId).catch(() => EMPTY_SUMMARY) : EMPTY_SUMMARY;
  // SPEC-049b: orgs do usuário para o seletor (só provider; falha não derruba o layout — sem seletor).
  const orgs = user.platformRole === "provider" && user.orgId ? await listMyOrganizations().catch(() => null) : null;
  const organizations = orgs && orgs.ok ? orgs.data.organizations : [];
  // D-049-16: catálogo público de planos (global, não por tenant) para "Criar organização" no seletor.
  const plans = organizations.length
    ? (await listActivePlans().catch(() => [])).filter((p) => p.selfServiceCheckout).map((p) => ({ key: p.key, name: p.name, priceMonthlyCents: p.priceMonthlyCents }))
    : [];
  return (
    <SidebarProvider defaultOpen={defaultOpen} className="h-svh min-h-0 overflow-hidden">
      <NotificationsProvider initial={summary}>
      <AppSidebar user={{ name: user.name, email: user.email }} platformRole={user.platformRole} organizations={organizations} plans={plans} />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <Header user={{ name: user.name, email: user.email }} initialTheme={initialTheme} />
        {!user.emailVerified && <VerifyEmailBanner email={user.email} />}
        <React.Suspense fallback={null}>
          <SubscriptionPendingBanner />
        </React.Suspense>
        <React.Suspense fallback={null}>
          <HealthBanner />
        </React.Suspense>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">{children}</div>
      </SidebarInset>
      </NotificationsProvider>
    </SidebarProvider>
  );
}
