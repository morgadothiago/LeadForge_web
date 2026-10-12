"use client";

import * as React from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlanCard } from "@/components/billing/PlanCard";
import { cn } from "@/lib/utils";
import type { PlanView } from "@/lib/billing/plans";
import { SALES_CONTACT_HREF } from "@/components/billing/sales-contact";

/**
 * SPEC-035 — pricing público, reaproveita `PlanCard` (SPEC-034) e `listActivePlans()` (chamado no
 * server component pai, `src/app/page.tsx`, e passado aqui como prop). CTA de cada card:
 * `/signup?plan=<key>&cadence=<monthly|yearly>` para planos self-service; "business" (sem
 * `selfServiceCheckout`) aponta para contato comercial em vez de checkout (D-33-2 / escopo da SPEC).
 *
 * AVISO DE ENTREGA: preços/limites vêm de `Plan` (seed D-33-2, placeholder) — precisam confirmação de
 * negócio antes do launch. O e-mail de contato comercial do plano Business é placeholder
 * (`contato@leadforge.com`) — trocar pelo canal comercial real antes do launch.
 */

export function PricingSection({ plans }: { plans: PlanView[] }) {
  const [cadence, setCadence] = React.useState<"monthly" | "yearly">("monthly");

  return (
    <section id="precos" className="py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">Planos para todo tamanho de time</h2>
          <p className="mt-3 text-base text-muted-foreground sm:text-lg">
            Teste 14 dias grátis e escolha o plano quando precisar.
          </p>
        </div>

        <div className="mt-8 flex justify-center">
          <Tabs value={cadence} onValueChange={(v) => setCadence(v as "monthly" | "yearly")}>
            <TabsList aria-label="Cadência de cobrança">
              <TabsTrigger value="monthly">Mensal</TabsTrigger>
              <TabsTrigger value="yearly">Anual</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {plans.length === 0 ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            Nenhum plano disponível no momento. Fale com a gente: <a className="text-accent-foreground underline-offset-2 hover:underline" href={SALES_CONTACT_HREF}>contato@leadforge.com</a>.
          </p>
        ) : (
          <div className="mx-auto mt-10 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => (
              <PlanCard
                key={plan.key}
                plan={plan}
                cadence={cadence}
                highlighted={plan.key === "pro"}
                className="rounded-2xl shadow-sm shadow-black/[0.03]"
                footer={
                  plan.selfServiceCheckout ? (
                    <Link
                      href={`/signup?plan=${encodeURIComponent(plan.key)}&cadence=${cadence}`}
                      className={cn(buttonVariants({ pill: true }), "w-full")}
                    >
                      Começar 14 dias grátis
                      <span className="sr-only"> no plano {plan.name}</span>
                    </Link>
                  ) : (
                    <a href={SALES_CONTACT_HREF} className={cn(buttonVariants({ variant: "outline", pill: true }), "w-full")}>
                      Falar com vendas
                    </a>
                  )
                }
              />
            ))}
          </div>
        )}

        <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-border bg-card p-5 text-left sm:p-6">
          <h3 className="font-heading text-base font-semibold">O que acontece quando o teste acaba?</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            O teste dura 14 dias, sem cartão, com limites reduzidos. Quando termina, o acesso fica pausado e nada é cobrado sozinho. Os seus dados ficam
            guardados: é só assinar um plano para voltar exatamente de onde parou. Cada pessoa ou empresa tem um único teste.
          </p>
        </div>
      </div>
    </section>
  );
}
