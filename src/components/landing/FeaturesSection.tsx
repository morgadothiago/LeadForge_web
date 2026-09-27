import {
  Bot,
  CalendarClock,
  Kanban,
  MessageCircle,
  Search,
  Target,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * SPEC-035 — grid de features mapeado 1:1 com o que o produto já faz (specs 004-029): campanhas+ICP,
 * sequences multicanal, WhatsApp, busca de leads por IA, agentes de IA (sdr/followup/closer — ver
 * `src/lib/agents/types.ts`), pipeline Kanban e calendário/reuniões. Nenhuma feature nova/inexistente.
 */
const FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Target,
    title: "Campanhas por ICP",
    description: "Defina o perfil de cliente ideal e organize a prospecção em campanhas segmentadas, do jeito que sua equipe já vende.",
  },
  {
    icon: Workflow,
    title: "Sequences multicanal",
    description: "Monte cadências de contato com múltiplas etapas e canais, com pausas e intervalos configuráveis por sequência.",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp integrado",
    description: "Conecte instâncias de WhatsApp e converse com leads sem sair do fluxo de prospecção, com histórico centralizado.",
  },
  {
    icon: Search,
    title: "Busca de leads por IA",
    description: "Encontre leads alinhados ao seu ICP com apoio de IA, direto na plataforma, sem depender de listas compradas.",
  },
  {
    icon: Bot,
    title: "Agentes de IA (SDR, Follow-up, Closer)",
    description: "Agentes especializados cuidam do primeiro contato, dos lembretes de follow-up e da condução até o fechamento — sempre com revisão antes do envio.",
  },
  {
    icon: Kanban,
    title: "Pipeline Kanban",
    description: "Acompanhe cada lead por etapa do funil, do primeiro contato ao negócio fechado, com visão clara do que precisa de atenção.",
  },
  {
    icon: CalendarClock,
    title: "Calendário de reuniões",
    description: "Reuniões agendadas aparecem organizadas por dia, semana e mês, com lembrete automático para você e para o lead.",
  },
];

export function FeaturesSection() {
  return (
    <section id="produto" className="border-y border-border bg-muted/40 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">Tudo que sua prospecção precisa, num só lugar</h2>
          <p className="mt-3 text-base text-muted-foreground sm:text-lg">
            Do primeiro contato ao fechamento, o LeadForge automatiza o trabalho repetitivo para o seu time focar em vender.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title} className="rounded-2xl border-border/70 p-6 shadow-sm shadow-black/[0.03] transition-shadow hover:shadow-md hover:shadow-primary/5">
              <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <f.icon size={22} aria-hidden="true" />
              </div>
              <h3 className="mt-4 font-heading text-base font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.description}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
