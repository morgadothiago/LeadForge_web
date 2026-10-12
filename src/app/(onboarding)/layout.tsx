import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { requireUser, UnauthorizedError, type CurrentUser } from "@/lib/auth/require-user";
import { parseTheme, THEME_COOKIE_NAME } from "@/lib/theme-state";

export const dynamic = "force-dynamic";

/**
 * SPEC-062b (D-062-9) — layout mínimo das telas de quem ainda NÃO tem organização (`/assinar`, `/assinar/retorno`,
 * `/organizacao/nova`, `/entrar-em-organizacao`, `/minha-conta`): logo, nome do usuário, tema e "Sair". Sem sidebar de tenant.
 * Todas exigem sessão (o `proxy.ts` redireciona anônimo ao `/login`; aqui só cobre sessão inválida). Cada página aplica a
 * guarda de estado (`requireStagePage`).
 */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  let user: CurrentUser;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect("/login");
    throw e;
  }
  const theme = parseTheme((await cookies()).get(THEME_COOKIE_NAME)?.value);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-2 px-4 sm:px-6">
          <span className="font-heading text-xl font-bold text-primary">LeadForge</span>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <ThemeToggle initialTheme={theme} />
            <Link
              href="/minha-conta"
              className="hidden min-w-0 rounded-md px-2 py-1 text-right leading-tight outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/40 sm:block"
              aria-label={`Minha conta: ${user.name}`}
            >
              <span className="block max-w-40 truncate text-sm font-medium">{user.name}</span>
              <span className="block max-w-40 truncate text-xs text-muted-foreground">{user.email}</span>
            </Link>
            <Link href="/minha-conta" className="rounded-md px-2 py-1.5 text-sm font-medium text-primary outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/40 sm:hidden">
              Minha conta
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>
    </div>
  );
}
