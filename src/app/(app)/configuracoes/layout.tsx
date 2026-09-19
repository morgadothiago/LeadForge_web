import type { ReactNode } from "react";
import { SettingsTabs } from "@/components/settings/SettingsTabs";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <SettingsTabs />
      {children}
    </div>
  );
}
