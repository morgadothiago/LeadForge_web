import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { MobileNav } from "./MobileNav";
import { PageTitle } from "./PageTitle";

export function Header({ user }: { user: { name: string; email: string } }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4 md:px-6">
      <MobileNav user={user} />
      <PageTitle />
      <div className="relative ml-auto hidden w-full max-w-xs sm:block">
        <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" aria-label="Buscar" placeholder="Buscar..." className="pl-9" />
      </div>
      <div className="ml-auto flex items-center gap-2 sm:ml-0">
        <div className="hidden min-w-0 text-right leading-tight md:block">
          <p className="max-w-40 truncate text-sm font-medium">{user.name}</p>
          <p className="max-w-40 truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <div
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold uppercase text-muted-foreground"
        >
          {(user.name || user.email).charAt(0)}
        </div>
        <LogoutButton className="hidden lg:inline-flex" />
      </div>
    </header>
  );
}
