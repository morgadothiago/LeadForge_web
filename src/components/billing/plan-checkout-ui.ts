import type { FieldErrors } from "@/lib/actions/result";
import type { PlanCheckoutState } from "@/lib/actions/billing";

/**
 * SPEC-062b — helpers puros (sem React) das telas `/assinar` e `/assinar/retorno`: leitura de `?plan=&cadence=`, mensagens dos
 * erros tipados de `startPlanCheckout` e a maquina de estados do polling do retorno.
 */
export type Cadence = "monthly" | "yearly";

export function resolveCadence(raw: string | undefined | null): Cadence {
  return raw === "yearly" ? "yearly" : "monthly";
}

/** Plano de intencao (vindo da landing): so vale se existir na lista self-service exibida; senao `null` (ignorado, nunca erro). */
export function resolveIntentPlan(raw: string | undefined | null, plans: readonly { key: string; selfServiceCheckout: boolean }[]): string | null {
  if (!raw) return null;
  return plans.some((p) => p.key === raw && p.selfServiceCheckout) ? raw : null;
}

export type CheckoutErrorCode = "email_unverified" | "plan_unavailable" | "rate_limited" | "billing_unavailable" | "unknown";

export interface CheckoutErrorInfo {
  code: CheckoutErrorCode;
  title: string;
  message: string;
}

const KNOWN: readonly CheckoutErrorCode[] = ["email_unverified", "plan_unavailable", "rate_limited", "billing_unavailable"];

/** Mensagem em pt-BR para o erro tipado (`errors.code[0]`); o texto do servidor so e usado no caso desconhecido. */
export function checkoutErrorInfo(errors: FieldErrors): CheckoutErrorInfo {
  const raw = errors.code?.[0];
  const code = (KNOWN as readonly string[]).includes(raw ?? "") ? (raw as CheckoutErrorCode) : "unknown";
  switch (code) {
    case "email_unverified":
      return { code, title: "Confirme seu e-mail para assinar", message: "Enviamos um link de confirmação para a sua caixa de entrada. Depois de confirmar, volte aqui e escolha o plano." };
    case "plan_unavailable":
      return { code, title: "Esse plano não está disponível", message: "Escolha outro plano da lista. Se o problema continuar, fale com o suporte." };
    case "rate_limited":
      return { code, title: "Muitas tentativas", message: "Aguarde alguns minutos e tente novamente." };
    case "billing_unavailable":
      return { code, title: "Pagamento indisponível no momento", message: "Não conseguimos abrir a tela de pagamento agora. Nenhuma cobrança foi feita. Tente de novo em alguns minutos." };
    default:
      return { code, title: "Não foi possível iniciar o pagamento", message: errors._form?.[0] ?? Object.values(errors).flat()[0] ?? "Tente novamente em instantes." };
  }
}

/** Polling do retorno do checkout (D-062-11): a cada 3 s por ate ~3 min. */
export const POLL_INTERVAL_MS = 3_000;
export const POLL_MAX_MS = 180_000;

export type ReturnView = "confirming" | "paid" | "failed" | "none" | "timeout" | "error";

/**
 * Estado exibido em `/assinar/retorno`. A VERDADE e o status da `Subscription` (webhook); `?checkout=success` na URL nunca
 * entra aqui. `timedOut` so importa enquanto ainda `incomplete`. `requestFailed` = a consulta falhou (rede/5xx/sessao) e o polling parou: vence qualquer status anterior.
 */
export function resolveReturnView(status: PlanCheckoutState["status"] | null, opts: { timedOut: boolean; requestFailed: boolean }): ReturnView {
  // Falha de consulta tem precedencia: o polling para ao falhar, entao "confirmando" seria um spinner eterno; "error" oferece "Verificar de novo".
  if (opts.requestFailed) return "error";
  if (status === null) return "confirming";
  switch (status) {
    case "active":
      return "paid";
    case "past_due":
    case "canceled":
      return "failed";
    case "none":
      return "none";
    case "incomplete":
      return opts.timedOut ? "timeout" : "confirming";
  }
}

/** Continua consultando enquanto a verdade ainda nao chegou. */
export function shouldKeepPolling(view: ReturnView): boolean {
  return view === "confirming";
}

/** `errors` sem a chave tecnica `code` (ex.: `no_paid_plan`): serve para decidir a UI, nunca entra na mensagem exibida. */
export function withoutCodeKey(errors: FieldErrors): FieldErrors {
  return Object.fromEntries(Object.entries(errors).filter(([k]) => k !== "code"));
}
