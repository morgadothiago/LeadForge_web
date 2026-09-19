import * as React from "react";
import { redirect } from "next/navigation";
import { HealthBanner } from "@/components/layout/HealthBanner";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
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
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={{ name: user.name, email: user.email }} />
        <React.Suspense fallback={null}>
          <HealthBanner />
        </React.Suspense>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
