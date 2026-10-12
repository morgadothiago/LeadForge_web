"use client";
import * as React from "react";
import { LockKeyhole } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/components/leads/lead-format";
import { blockedPanelCopy } from "./trial-blocked-copy";

/**
 * SPEC-065b (D-065-13/14) — tela de BLOQUEIO do teste gratis expirado, no topo de `/configuracoes/assinatura`. Dono: explica, diz que os
 * dados estao guardados e aponta para a escolha do plano (checkout). Membro: pede que o proprietario assine (sem botao de pagar).
 * Quando o trial NASCEU expirado (e-mail/documento ja usou o teste) a mensagem e generica e nao diz qual dado bateu.
 * `role="status"` e o titulo recebe foco ao abrir (leitor de tela anuncia o motivo do bloqueio).
 */
export function TrialBlockedPanel({ isOwner, ownerName, endedAt, neverGranted }: { isOwner: boolean; ownerName: string | null; endedAt: Date | null; neverGranted: boolean }) {
  const ref = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    ref.current?.focus();
  }, []);
  const copy = blockedPanelCopy({ isOwner, ownerName, endedAtText: endedAt ? formatDate(endedAt) : null, neverGranted });
  return (
    <Card data-slot="trial-blocked" className="mx-auto w-full max-w-2xl space-y-4 border-warning/40 p-5 text-center sm:p-8">
      <div role="status" className="space-y-3">
        <span aria-hidden="true" className="mx-auto flex size-12 items-center justify-center rounded-full bg-warning/15 text-warning">
          <LockKeyhole className="size-6" />
        </span>
        <h2 ref={ref} tabIndex={-1} className="font-heading text-xl font-semibold outline-none sm:text-2xl">
          {copy.title}
        </h2>
        <p className="text-sm text-muted-foreground">{copy.text}</p>
      </div>
      {isOwner && (
        <a href="#planos" className={buttonVariants({ size: "lg" })}>
          Escolher plano
        </a>
      )}
    </Card>
  );
}
