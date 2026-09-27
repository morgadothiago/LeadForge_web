import { Bot, MessageCircle, Workflow } from "lucide-react";

/**
 * SPEC-035 — D-35-2: prova social omitida por enquanto (sem cliente/depoimento/logo real documentado).
 * Espaço reservado com métricas agregadas GENÉRICAS do produto (capacidade da plataforma, não números
 * de clientes reais/inventados) — nenhum nome, logo ou depoimento fabricado.
 */
const CAPABILITIES = [
  { icon: Workflow, label: "Campanhas e sequences rodando 24/7" },
  { icon: Bot, label: "Agentes de IA revisando cada mensagem antes do envio" },
  { icon: MessageCircle, label: "Múltiplos canais num único histórico de conversa" },
] as const;

export function SocialProofSection() {
  return (
    <section aria-label="Sobre a plataforma" className="border-y border-border bg-muted/40 py-10 sm:py-14">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <ul className="grid gap-6 sm:grid-cols-3">
          {CAPABILITIES.map((c) => (
            <li key={c.label} className="flex items-center gap-3 text-sm font-medium text-muted-foreground sm:justify-center sm:text-center">
              <c.icon size={18} className="shrink-0 text-primary" aria-hidden="true" />
              <span>{c.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
