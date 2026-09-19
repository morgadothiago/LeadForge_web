"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SettingsTabs() {
  const pathname = usePathname();
  const emailActive = pathname.startsWith("/configuracoes/email");
  return (
    <nav aria-label="Seções de configurações" className="flex gap-1.5 border-b border-border pb-3">
      <Link
        href="/configuracoes/email"
        aria-current={emailActive ? "page" : undefined}
        className={cn(
          "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          emailActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
        )}
      >
        E-mail
      </Link>
      <span aria-disabled="true" className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground/60">
        WhatsApp
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">em breve</span>
      </span>
    </nav>
  );
}
