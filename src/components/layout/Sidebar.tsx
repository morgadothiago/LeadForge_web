import { Logo } from "./Logo";
import { SidebarNav } from "./SidebarNav";

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-[#202226] bg-[#111417] lg:flex">
      <Logo />
      <SidebarNav />
    </aside>
  );
}
