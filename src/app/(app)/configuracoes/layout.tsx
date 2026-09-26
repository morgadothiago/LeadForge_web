import type { ReactNode } from "react";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { requireUser } from "@/lib/auth/require-user";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  // Só esconde a aba (UX); a barreira real é requireProviderOrg (SPEC-030). Sem sessão: aba oculta.
  const isAdmin = await requireUser().then((u) => u.platformRole === "provider", () => false);
  return (
    <div className="space-y-6">
      <SettingsTabs isAdmin={isAdmin} />
      {children}
    </div>
  );
}
