"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import type { Theme } from "@/lib/theme-state";

const ANCHOR_LINKS = [
  { href: "#produto", label: "Produto" },
  { href: "#precos", label: "Preços" },
  { href: "#sobre", label: "Sobre" },
] as const;

/**
 * SPEC-035 — nav superior da landing pública. "Estado ativo em pill escuro" (referência do usuário):
 * aqui aplicado ao link de âncora em foco/hover, já que não há rota ativa de fato (página única com
 * scroll) — o pill marca a seção que o visitante está prestes a visitar, não uma rota atual.
 */
export function LandingNav({ initialTheme }: { initialTheme: Theme }) {
  const [open, setOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="font-heading text-lg font-bold text-foreground">
          LeadForge
        </Link>

        <nav aria-label="Navegação principal" className="hidden items-center gap-1 md:flex">
          {ANCHOR_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-full px-3.5 py-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:bg-foreground focus-visible:text-background focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <ThemeToggle initialTheme={initialTheme} />
          <Link href="/login" className={cn("text-sm font-medium text-muted-foreground transition-colors hover:text-foreground", "rounded-full px-3.5 py-1.5")}>
            Entrar
          </Link>
          <Link href="/signup" className={buttonVariants({ pill: true })}>
            Começar
          </Link>
        </div>

        <div className="ml-auto flex items-center gap-1 md:hidden">
          <ThemeToggle initialTheme={initialTheme} />
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-full text-foreground"
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            aria-expanded={open}
            aria-controls="landing-mobile-menu"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {open && (
        <nav id="landing-mobile-menu" aria-label="Navegação principal (mobile)" className="border-t border-border bg-background px-4 pb-4 md:hidden">
          <ul className="flex flex-col gap-1 pt-3">
            {ANCHOR_LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
            <Link href="/login" className="rounded-lg px-3 py-2 text-center text-sm font-medium text-foreground hover:bg-muted">
              Entrar
            </Link>
            <Link href="/signup" className={cn(buttonVariants({ pill: true }), "w-full")}>
              Começar
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
