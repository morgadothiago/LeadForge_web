import * as React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HealthBanner } from "@/components/layout/HealthBanner";
import { VerifyEmailBanner } from "@/components/auth/VerifyEmailBanner";
import { PendingSetupBanner } from "@/components/billing/PendingSetupBanner";
import { SubscriptionPendingBanner } from "@/components/billing/SubscriptionPendingBanner";
import { AiBudgetBanner } from "@/components/billing/AiBudgetBanner";
import { TrialBanner } from "@/components/billing/TrialBanner";
import { showsTrialChip } from "@/components/billing/trial-ui";
import { trialDaysLeft } from "@/lib/billing/access";
import { getOrgBannerState } from "@/lib/queries/billing";
import { Header } from "@/components/layout/Header";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { parseSidebarDefaultOpen } from "@/lib/sidebar-state";
import { parseTheme, THEME_COOKIE_NAME } from "@/lib/theme-state";
import { InboxUnreadProvider } from "@/components/inbox/InboxUnreadProvider";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";
import { getNotificationSummary } from "@/lib/notifications/summary";
import { EMPTY_SUMMARY } from "@/lib/notifications/client-types";
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
  const summary = user.orgId && user.orgAccess !== "trial_expirado" ? await getNotificationSummary(user.orgId).catch(() => EMPTY_SUMMARY) : EMPTY_SUMMARY;
  // SPEC-049b: orgs do usuário para o seletor (só provider; falha não derruba o layout — sem seletor).
  const orgs = user.platformRole === "provider" && user.orgId ? await listMyOrganizations().catch(() => null) : null;
  const organizations = orgs && orgs.ok ? orgs.data.organizations : [];
  // SPEC-065b (D-065-13.4/24): shell reduzido no trial expirado (bloqueio total) e chip/banner de dias no teste. Falha de leitura nao derruba o layout.
  const restricted = user.platformRole === "provider" && user.orgAccess === "trial_expirado";
  const trialState = showsTrialChip(user.orgAccess) ? await getOrgBannerState().catch(() => null) : null;
  const daysLeft = trialState?.subscriptionStatus === "trialing" ? trialDaysLeft(trialState.trialEndsAt, new Date()) : 0;
  const trial = daysLeft > 0 ? { daysLeft, expiring: user.orgAccess === "trial_expirando" } : null;
  return (
    <SidebarProvider defaultOpen={defaultOpen} className="h-svh min-h-0 overflow-hidden">
      <NotificationsProvider initial={summary}>
      <InboxUnreadProvider enabled={user.platformRole === "provider" && !restricted}>
      <AppSidebar user={{ name: user.name, email: user.email }} platformRole={user.platformRole} organizations={organizations} restricted={restricted} />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <Header user={{ name: user.name, email: user.email }} initialTheme={initialTheme} trial={trial} restricted={restricted} />
        {!user.emailVerified && <VerifyEmailBanner email={user.email} />}
        {trial?.expiring && <TrialBanner daysLeft={trial.daysLeft} />}
        {user.platformRole === "provider" && (
          <React.Suspense fallback={null}>
            <PendingSetupBanner userId={user.id} platformRole={user.platformRole} />
          </React.Suspense>
        )}
        {!restricted && (
          <>
            <React.Suspense fallback={null}>
              <SubscriptionPendingBanner />
            </React.Suspense>
            <React.Suspense fallback={null}>
              <HealthBanner />
            </React.Suspense>
            {user.platformRole === "provider" && (
              <React.Suspense fallback={null}>
                <AiBudgetBanner />
              </React.Suspense>
            )}
          </>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">{children}</div>
      </SidebarInset>
      </InboxUnreadProvider>
      </NotificationsProvider>
    </SidebarProvider>
  );
}
