import Link from "next/link";

/**
 * SPEC-035 — footer institucional mínimo (fora do escopo: blog/changelog/páginas institucionais além
 * do necessário aqui). Links de âncora reaproveitam as seções já existentes na própria landing.
 */
export function LandingFooter() {
  return (
    <footer id="sobre" className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6 lg:px-8">
        <div className="space-y-2">
          <p className="font-heading text-lg font-bold text-foreground">LeadForge</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Prospecção B2B automatizada com campanhas, sequências multicanal e agentes de IA.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Produto</p>
            <ul className="space-y-1.5 text-sm">
              <li><a href="#produto" className="text-muted-foreground hover:text-foreground">Recursos</a></li>
              <li><a href="#precos" className="text-muted-foreground hover:text-foreground">Preços</a></li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conta</p>
            <ul className="space-y-1.5 text-sm">
              <li><Link href="/login" className="text-muted-foreground hover:text-foreground">Entrar</Link></li>
              <li><Link href="/signup" className="text-muted-foreground hover:text-foreground">Criar conta</Link></li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contato</p>
            <ul className="space-y-1.5 text-sm">
              <li>
                <a href="mailto:contato@leadforge.com" className="text-muted-foreground hover:text-foreground">
                  contato@leadforge.com
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div className="border-t border-border px-4 py-4 text-center text-xs text-muted-foreground sm:px-6 lg:px-8">
        © {new Date().getFullYear()} LeadForge. Todos os direitos reservados.
      </div>
    </footer>
  );
}
