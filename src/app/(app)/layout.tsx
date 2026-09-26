import * as React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HealthBanner } from "@/components/layout/HealthBanner";
import { Header } from "@/components/layout/Header";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { parseSidebarDefaultOpen } from "@/lib/sidebar-state";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";
import { getNotificationSummary } from "@/lib/notifications/summary";
import { EMPTY_SUMMARY } from "@/lib/notifications/client-types";
import { Toaster } from "@/components/ui/sonner";
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
  const defaultOpen = parseSidebarDefaultOpen((await cookies()).get("sidebar_state")?.value);
  const summary = await getNotificationSummary().catch(() => EMPTY_SUMMARY);
  return (
    <SidebarProvider defaultOpen={defaultOpen} className="h-svh min-h-0 overflow-hidden">
      <NotificationsProvider initial={summary}>
      <AppSidebar user={{ name: user.name, email: user.email }} />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <Header user={{ name: user.name, email: user.email }} />
        <React.Suspense fallback={null}>
          <HealthBanner />
        </React.Suspense>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">{children}</div>
      </SidebarInset>
      </NotificationsProvider>
      <Toaster />
    </SidebarProvider>
  );
}
