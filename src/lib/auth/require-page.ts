import { redirect } from "next/navigation";
import { requireUser, UnauthorizedError, type CurrentUser } from "./require-user";
import { requireProviderOrg } from "./require-admin";

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

/** Idem para páginas que precisam de org (`provider` com `orgId`). `ForbiddenError` continua estourando. */
export async function requirePageProviderOrg(): Promise<{ user: CurrentUser; orgId: string }> {
  try {
    return await requireProviderOrg();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect("/login");
    throw e;
  }
}
