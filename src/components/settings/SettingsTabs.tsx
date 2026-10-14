"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/configuracoes/email", label: "E-mail" },
  { href: "/configuracoes/whatsapp", label: "WhatsApp" },
  { href: "/configuracoes/supressao", label: "Supressão" },
  { href: "/configuracoes/equipe", label: "Equipe", adminOnly: true },
  { href: "/configuracoes/agentes", label: "Agentes", adminOnly: true },
  { href: "/configuracoes/assinatura", label: "Assinatura", adminOnly: true },
  { href: "/configuracoes/conta", label: "Conta" },
] as const;

/** SPEC-065b (D-065-14): com o teste gratis expirado so Assinatura e Conta abrem; as outras abas redirecionariam. */
const RESTRICTED_TABS: readonly string[] = ["/configuracoes/assinatura", "/configuracoes/conta"];

/** `isAdmin` vem do servidor (role); é só UX: a barreira real é requireAdmin nas actions/queries/página. */
export function SettingsTabs({ isAdmin = false, restricted = false }: { isAdmin?: boolean; restricted?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Seções de configurações" className="flex gap-1.5 overflow-x-auto border-b border-border pb-3">
      {TABS.filter((t) => (!("adminOnly" in t) || isAdmin) && (!restricted || RESTRICTED_TABS.includes(t.href))).map((t) => {
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
