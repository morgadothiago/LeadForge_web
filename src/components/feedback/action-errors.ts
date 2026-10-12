import type { FieldErrors } from "@/lib/actions/result";

/**
 * SPEC-065b — helper UNICO de mensagens de erro do backend (ActionResult.errors) em PT-BR para a UI. Le os codigos tipados da 065a
 * (`plan_limit`, `trial_expired`) e da 055/062 (`email_not_verified`, `email_unverified`), devolve a mensagem exibivel e, quando faz
 * sentido, um CTA (rotulo + destino). Puro (sem React/sonner): a parte visual e `notifyActionError` (`notify.ts`).
 */
export type ActionErrorCode = "plan_limit" | "trial_expired" | "email_not_verified" | "email_unverified" | "rate_limited" | null;

export interface ActionErrorInfo {
  code: ActionErrorCode;
  message: string;
  cta: { label: string; href: string } | null;
}

const KNOWN: readonly string[] = ["plan_limit", "trial_expired", "email_not_verified", "email_unverified", "rate_limited"];
const FALLBACK = "Não foi possível concluir a operação. Tente novamente.";

export function actionErrorInfo(errors: FieldErrors | undefined, fallback: string = FALLBACK): ActionErrorInfo {
  const raw = errors?.code?.[0];
  const code = (KNOWN.includes(raw ?? "") ? raw : null) as ActionErrorCode;
  // A chave tecnica `code` (e `metric`/`limit`/`used`) nunca entra na mensagem.
  const message = errors?._form?.[0] ?? Object.entries(errors ?? {}).filter(([k]) => !["code", "metric", "limit", "used"].includes(k)).flatMap(([, v]) => v)[0] ?? fallback;
  if (code === "plan_limit") return { code, message, cta: { label: "Fazer upgrade", href: "/configuracoes/assinatura" } };
  if (code === "trial_expired") return { code, message: "Seu teste grátis terminou. Assine um plano para continuar.", cta: { label: "Ver assinatura", href: "/configuracoes/assinatura" } };
  return { code, message, cta: null };
}
