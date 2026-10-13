"use client";
import { toast } from "sonner";
import type { FieldErrors } from "@/lib/actions/result";
import { actionErrorInfo, isPlanOrPolicyError } from "./action-errors";

/**
 * SPEC-065b — toast de erro do backend com CTA quando o erro e `plan_limit` ("Fazer upgrade") ou `trial_expired` ("Ver assinatura").
 * `message` (opcional) sobrepoe o texto, para formularios que ja calcularam a mensagem geral (ex.: `applyServerErrors`).
 */
/**
 * SPEC-069d — erros de plano/politica (`plan_limit`, `plan_feature_locked`, `policy_*`, `trial_expired`) viram toast com a mensagem do servidor + CTA; os
 * demais mantem o `text` que a tela ja calculou (compatibilidade com formularios que mostram erro por campo).
 */
export function notifyActionErrorOr(errors: FieldErrors | undefined, text: string): void {
  if (isPlanOrPolicyError(errors)) notifyActionError(errors);
  else toast.error(text);
}

export function notifyActionError(errors: FieldErrors | undefined, message?: string): void {
  const info = actionErrorInfo(errors, message);
  const text = info.code === "trial_expired" ? info.message : (message ?? info.message);
  if (info.cta) {
    const { href, label } = info.cta;
    toast.error(text, { duration: 10000, action: { label, onClick: () => window.location.assign(href) } });
    return;
  }
  toast.error(text);
}
