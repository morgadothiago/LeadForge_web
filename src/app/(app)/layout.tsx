import * as React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HealthBanner } from "@/components/layout/HealthBanner";
import { SubscriptionPendingBanner } from "@/components/billing/SubscriptionPendingBanner";
import { Header } from "@/components/layout/Header";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { parseSidebarDefaultOpen } from "@/lib/sidebar-state";
import { parseTheme, THEME_COOKIE_NAME } from "@/lib/theme-state";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";
import { getNotificationSummary } from "@/lib/notifications/summary";
import { EMPTY_SUMMARY } from "@/lib/notifications/client-types";
import { requireUser, UnauthorizedError, type CurrentUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  let user: CurrentUser;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect("/login");
    throw e;
  }
  const cookieStore = await cookies();
  const defaultOpen = parseSidebarDefaultOpen(cookieStore.get("sidebar_state")?.value);
  const initialTheme = parseTheme(cookieStore.get(THEME_COOKIE_NAME)?.value);
  const summary = user.orgId ? await getNotificationSummary(user.orgId).catch(() => EMPTY_SUMMARY) : EMPTY_SUMMARY;
  return (
    <SidebarProvider defaultOpen={defaultOpen} className="h-svh min-h-0 overflow-hidden">
      <NotificationsProvider initial={summary}>
      <AppSidebar user={{ name: user.name, email: user.email }} platformRole={user.platformRole} />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <Header user={{ name: user.name, email: user.email }} initialTheme={initialTheme} />
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
