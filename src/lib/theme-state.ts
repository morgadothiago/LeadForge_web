export type Theme = "light" | "dark";

/** SPEC-037 — cookie `theme` (mesmo padrão de `sidebar_state`, ver `sidebar-state.ts`): "dark" =>
 * modo escuro; ausente/qualquer outro valor => modo claro (D-037-1: default `light`). */
export const THEME_COOKIE_NAME = "theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseTheme(value: string | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}
