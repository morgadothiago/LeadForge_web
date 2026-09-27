"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { THEME_COOKIE_MAX_AGE, THEME_COOKIE_NAME, type Theme } from "@/lib/theme-state";

/**
 * SPEC-037 — toggle de tema claro/escuro, componente único reaproveitado no `Header` (área logada)
 * e no `LandingNav` (landing pública). `initialTheme` vem do servidor (cookie `theme` lido em RSC,
 * mesmo padrão de `sidebar_state`/`parseSidebarDefaultOpen`) para o ícone já nascer certo, sem
 * depender de leitura do DOM no client (evita mismatch de hidratação).
 */
export function ThemeToggle({ initialTheme, className }: { initialTheme: Theme; className?: string }) {
  const [theme, setTheme] = React.useState<Theme>(initialTheme);
  const isDark = theme === "dark";

  const toggle = () => {
    const next: Theme = isDark ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    document.cookie = `${THEME_COOKIE_NAME}=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE}`;
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={isDark ? "Ativar tema claro" : "Ativar tema escuro"}
      title={isDark ? "Tema claro" : "Tema escuro"}
      onClick={toggle}
      className={cn("shrink-0", className)}
    >
      {isDark ? <Sun aria-hidden="true" className="size-4" /> : <Moon aria-hidden="true" className="size-4" />}
    </Button>
  );
}
