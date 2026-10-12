import { redirect } from "next/navigation";
import { requireUser, UnauthorizedError, type CurrentUser } from "./require-user";
import { requireProviderOrg, TrialExpiredError } from "./require-admin";

/**
 * Variantes de `requireUser()`/`requireProviderOrg()` para páginas RSC: sem sessão vira
 * `redirect("/login")` em vez de `UnauthorizedError`. `redirect()` lança NEXT_REDIRECT, que o Next
 * NÃO trata como erro — assim não há stack trace no log nem cair no error boundary.
 *
 * Caso real (dashboard): o `POST` de logout destrói a sessão e o Next re-renderiza a página com a
 * sessão já apagada — a página lançava `UnauthorizedError` e poluía o log com o stack inteiro.
 *
 * Actions/queries continuam com `requireUser()` normal: a API precisa do erro tipado
 * (`UnauthorizedError` → 401/`formError`), não de redirect.
 */
export async function requirePageUser(): Promise<CurrentUser> {
  try {
    return await requireUser();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect("/login");
    throw e;
  }
}

/** Destino do bloqueio total do trial expirado (SPEC-065, D-065-14). */
export const TRIAL_EXPIRED_ROUTE = "/configuracoes/assinatura";

/**
 * Idem para páginas que precisam de org (`provider` com `orgId`). `ForbiddenError` continua estourando.
 * SPEC-065 (D-065-13.3): org com trial expirado => `redirect("/configuracoes/assinatura")` (so a pagina de assinatura e a de conta ficam acessiveis).
 */
export async function requirePageProviderOrg(): Promise<{ user: CurrentUser; orgId: string }> {
  try {
    return await requireProviderOrg();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect("/login");
    if (e instanceof TrialExpiredError) redirect(TRIAL_EXPIRED_ROUTE);
    throw e;
  }
}

/**
 * SPEC-065 (D-065-13.3): barreira de PAGINA para o bloqueio total, sem mudar o tratamento de erros da propria pagina. So redireciona
 * quando a org da sessao esta `trial_expirado`; sem sessao => `/login`; qualquer outro caso (ex.: `platform_admin`) segue como antes.
 * Toda `page.tsx` de `(app)` fora da allowlist chama isto (ou `requirePageProviderOrg`) — coberto por `trial-guard-coverage.test.ts`.
 */
export async function redirectIfTrialExpired(): Promise<void> {
  let user: CurrentUser;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect("/login");
    throw e;
  }
  if (user.platformRole === "provider" && user.orgAccess === "trial_expirado") redirect(TRIAL_EXPIRED_ROUTE);
}
