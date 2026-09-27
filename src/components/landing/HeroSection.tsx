import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { HeroVisual } from "./HeroVisual";

export function HeroSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20 lg:px-8">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="space-y-6 text-center lg:text-left">
          <span className="inline-flex items-center rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
            Prospecção B2B com IA
          </span>
          <h1 className="font-heading text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-[3.25rem]">
            Prospecte, engaje e feche negócios{" "}
            <span className="text-primary">no piloto automático</span>
          </h1>
          <p className="mx-auto max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg lg:mx-0">
            O LeadForge combina campanhas segmentadas por ICP, sequências multicanal e agentes de IA para
            encontrar, engajar e agendar reuniões com os leads certos — sem planilha, sem esforço manual.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link href="/signup" className={buttonVariants({ size: "lg", pill: true }) + " w-full gap-2 sm:w-auto"}>
              Começar agora
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <a href="#precos" className={buttonVariants({ variant: "outline", size: "lg", pill: true }) + " w-full sm:w-auto"}>
              Ver preços
            </a>
          </div>
          <p className="text-xs text-muted-foreground">Sem cartão de crédito para começar o teste.</p>
        </div>

        <div className="flex justify-center lg:justify-end">
          <HeroVisual />
        </div>
      </div>
    </section>
  );
}
