import { Search, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MobileNav } from "./MobileNav";
import { PageTitle } from "./PageTitle";

export function Header() {
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4 md:px-6">
      <MobileNav />
      <PageTitle />
      <div className="relative ml-auto hidden w-full max-w-xs sm:block">
        <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" aria-label="Buscar" placeholder="Buscar..." className="pl-9" />
      </div>
      <div
        role="img"
        aria-label="Usuário (em breve)"
        className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground sm:ml-0"
      >
        <User size={18} aria-hidden="true" />
      </div>
    </header>
  );
}
