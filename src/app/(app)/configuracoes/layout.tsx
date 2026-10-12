import type { ReactNode } from "react";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { requireUser } from "@/lib/auth/require-user";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  // Só esconde a aba (UX); a barreira real é requireProviderOrg (SPEC-030). Sem sessão: aba oculta.
  const me = await requireUser().then((u) => ({ isAdmin: u.platformRole === "provider", restricted: u.platformRole === "provider" && u.orgAccess === "trial_expirado" }), () => ({ isAdmin: false, restricted: false }));
  return (
    <div className="space-y-6">
      <SettingsTabs isAdmin={me.isAdmin} restricted={me.restricted} />
      {children}
    </div>
  );
}
