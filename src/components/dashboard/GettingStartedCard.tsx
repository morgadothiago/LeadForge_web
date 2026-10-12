"use client";
import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Circle, Rocket, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { dismissOnboardingCard } from "@/lib/onboarding-state";
import { cn } from "@/lib/utils";

export interface GettingStartedSteps {
  channel: boolean;
  campaign: boolean;
  leads: boolean;
}

export const GETTING_STARTED_ITEMS = [
  { key: "channel", title: "Conecte um e-mail ou um WhatsApp", text: "É por onde as suas mensagens saem.", href: "/configuracoes/email", cta: "Conectar" },
  { key: "campaign", title: "Crie a sua primeira campanha", text: "Diga quem você quer alcançar.", href: "/campanhas/nova", cta: "Criar campanha" },
  { key: "leads", title: "Traga os seus primeiros leads", text: "Cadastre à mão, importe ou busque.", href: "/leads", cta: "Ver leads" },
] as const;

/** Passos que ainda faltam; vazio = tudo feito (o cartao some sozinho). */
export function pendingSteps(steps: GettingStartedSteps): number {
  return GETTING_STARTED_ITEMS.filter((i) => !steps[i.key]).length;
}

/**
 * SPEC-065b (D-065-23) — cartao de "primeiros passos" do dashboard recem-criado: conectar canal, criar campanha, trazer leads. Some
 * sozinho quando os 3 passos estao feitos; "Dispensar" guarda a escolha em cookie por organizacao.
 */
export function GettingStartedCard({ orgId, steps }: { orgId: string; steps: GettingStartedSteps }) {
  const [hidden, setHidden] = React.useState(false);
  if (hidden || pendingSteps(steps) === 0) return null;
  const done = GETTING_STARTED_ITEMS.length - pendingSteps(steps);
  return (
    <Card role="region" aria-labelledby="getting-started-title" className="relative p-4 sm:p-5">
      <button
        type="button"
        onClick={() => {
          dismissOnboardingCard("steps", orgId);
          setHidden(true);
        }}
        aria-label="Dispensar os primeiros passos"
        className="absolute right-2 top-2 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      <div className="flex items-center gap-2 pr-8">
        <Rocket className="size-5 text-primary" aria-hidden="true" />
        <h2 id="getting-started-title" className="font-heading text-base font-semibold">
          Primeiros passos
        </h2>
        <span className="text-xs text-muted-foreground">
          {done} de {GETTING_STARTED_ITEMS.length}
        </span>
      </div>
      <ol className="mt-3 grid gap-2 md:grid-cols-3">
        {GETTING_STARTED_ITEMS.map((item) => {
          const ok = steps[item.key];
          return (
            <li key={item.key} className={cn("flex items-start gap-3 rounded-lg border border-border p-3", ok && "bg-muted/40")}>
              {ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" /> : <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <div className="min-w-0 flex-1 space-y-1">
                <p className={cn("text-sm font-medium", ok && "text-muted-foreground line-through")}>
                  {item.title}
                  <span className="sr-only">{ok ? " (feito)" : " (a fazer)"}</span>
                </p>
                <p className="text-xs text-muted-foreground">{item.text}</p>
                {!ok && (
                  <Link href={item.href} className="inline-flex min-h-9 items-center text-sm font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40">
                    {item.cta}
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
