"use client";

/**
 * Higiene de fim de sessão (client-side). Limpa `localStorage`/`sessionStorage` do navegador ao
 * deslogar, para que o próximo usuário autenticado no mesmo navegador/dispositivo não herde nenhum
 * estado (ex.: dedupe de toast de notificações em `sessionStorage`, ver `toast-dedupe.ts`) da conta
 * anterior. A action `logout()` (`src/lib/actions/auth.ts`) é server action e não tem acesso a
 * `window` — por isso essa limpeza é feita aqui, no client, depois que a action resolve com sucesso.
 */
export function clearClientStorage(): void {
  try {
    window.localStorage.clear();
  } catch {
    /* storage bloqueado (modo privado etc.) — segue sem quebrar o logout */
  }
  try {
    window.sessionStorage.clear();
  } catch {
    /* idem */
  }
}
