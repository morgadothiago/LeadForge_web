"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/configuracoes/email", label: "E-mail" },
  { href: "/configuracoes/whatsapp", label: "WhatsApp" },
  { href: "/configuracoes/supressao", label: "Supressão" },
  { href: "/configuracoes/agentes", label: "Agentes", adminOnly: true },
  { href: "/configuracoes/integracoes", label: "Integrações", adminOnly: true },
] as const;

/** `isAdmin` vem do servidor (role); é só UX: a barreira real é requireAdmin nas actions/queries/página. */
export function SettingsTabs({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Seções de configurações" className="flex gap-1.5 overflow-x-auto border-b border-border pb-3">
      {TABS.filter((t) => !("adminOnly" in t) || isAdmin).map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-9 shrink-0 items-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
