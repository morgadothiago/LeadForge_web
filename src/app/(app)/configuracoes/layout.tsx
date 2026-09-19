import type { ReactNode } from "react";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { requireUser } from "@/lib/auth/require-user";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  // Só esconde a aba (UX); a barreira real é requireAdmin. Sem sessão: aba oculta.
  const isAdmin = await requireUser().then((u) => u.role === "admin", () => false);
  return (
    <div className="space-y-6">
      <SettingsTabs isAdmin={isAdmin} />
      {children}
    </div>
  );
}
