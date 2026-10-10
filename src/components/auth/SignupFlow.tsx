"use client";
import * as React from "react";
import { Building2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { SignupForm } from "./SignupForm";
import { JoinWithCodeForm } from "./JoinWithCodeForm";

type Props = React.ComponentProps<typeof SignupForm>;
export type SignupMode = "create" | "join";

const OPTIONS: { value: SignupMode; title: string; desc: string; icon: typeof Building2 }[] = [
  { value: "create", title: "Criar uma organização", desc: "Sou o primeiro da minha empresa. Começo com 14 dias grátis.", icon: Building2 },
  { value: "join", title: "Participar de uma organização", desc: "Tenho um código de entrada ou convite da minha equipe.", icon: Users },
];

/**
 * SPEC-049b — passo de escolha do signup: "criar organização" (fluxo atual SPEC-033/034, com trial/checkout) ou
 * "participar de uma organização" (SPEC-049a `signUpAndJoin`, sem checkout). `initialMode` permite abrir direto
 * em "join" (`/signup?modo=participar`). Radios nativos (teclado/leitor de tela) estilizados como cartões.
 */
export function SignupFlow({ initialMode = "create", ...planProps }: Props & { initialMode?: SignupMode }) {
  const [mode, setMode] = React.useState<SignupMode>(initialMode);
  const name = React.useId();
  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">O que você quer fazer?</legend>
        <div className="grid gap-2">
          {OPTIONS.map(({ value, title, desc, icon: Icon }) => {
            const checked = mode === value;
            return (
              <label
                key={value}
                className={cn(
                  "flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-primary/40",
                  checked ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50",
                )}
              >
                <input type="radio" name={name} value={value} checked={checked} onChange={() => setMode(value)} className="sr-only" />
                <Icon aria-hidden="true" className={cn("mt-0.5 size-5 shrink-0", checked ? "text-primary" : "text-muted-foreground")} />
                <span className="grid gap-0.5 leading-snug">
                  <span className="text-sm font-medium">{title}</span>
                  <span className="text-xs text-muted-foreground">{desc}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {mode === "create" ? <SignupForm {...planProps} /> : <JoinWithCodeForm />}
    </div>
  );
}
