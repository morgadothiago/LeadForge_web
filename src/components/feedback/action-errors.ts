import type { FieldErrors } from "@/lib/actions/result";

/**
 * SPEC-065b/069d — helper UNICO de mensagens de erro do backend (ActionResult.errors) em PT-BR para a UI. Le os codigos tipados da 065a
 * (`plan_limit`, `trial_expired`), da 055/062 (`email_not_verified`, `email_unverified`) e da 069 (`plan_feature_locked`, `policy_admin_only`,
 * `policy_locked`), devolve a mensagem exibivel e, quando faz sentido, um CTA (rotulo + destino). Puro (sem React/sonner): a parte visual e
 * `notifyActionError` (`notify.ts`).
 */
export type ActionErrorCode =
  | "plan_limit"
  | "plan_feature_locked"
  | "policy_admin_only"
  | "policy_locked"
  | "trial_expired"
  | "email_not_verified"
  | "email_unverified"
  | "rate_limited"
  | null;

export interface ActionErrorInfo {
  code: ActionErrorCode;
  message: string;
  cta: { label: string; href: string } | null;
}

const KNOWN: readonly string[] = ["plan_limit", "plan_feature_locked", "policy_admin_only", "policy_locked", "trial_expired", "email_not_verified", "email_unverified", "rate_limited"];
/** Chaves tecnicas do ActionResult que nunca entram na mensagem. */
const TECHNICAL_KEYS: readonly string[] = ["code", "metric", "limit", "used", "feature", "requiredPlan", "reason", "fields"];
const FALLBACK = "Não foi possível concluir a operação. Tente novamente.";
const SUBSCRIPTION_HREF = "/configuracoes/assinatura";

/** Texto padrao quando o servidor nao mandou `_form` (ex.: so o codigo). */
const DEFAULT_MESSAGE: Partial<Record<Exclude<ActionErrorCode, null>, string>> = {
  plan_feature_locked: "Este recurso não está incluído no seu plano. Faça upgrade para usar.",
  policy_admin_only: "Este ajuste é definido pela plataforma. Peça ao administrador ou fale com o suporte.",
  policy_locked: "O kill switch foi travado pela plataforma. Somente o administrador pode desligá-lo.",
};

/** Erros de plano/politica (tem CTA ou texto proprio do servidor) que a UI deve mostrar com `notifyActionError` em vez de uma mensagem generica. */
export function isPlanOrPolicyError(errors: FieldErrors | undefined): boolean {
  const c = errors?.code?.[0];
  return c === "plan_limit" || c === "plan_feature_locked" || c === "trial_expired" || c === "policy_admin_only" || c === "policy_locked";
}

export function actionErrorInfo(errors: FieldErrors | undefined, fallback: string = FALLBACK): ActionErrorInfo {
  const raw = errors?.code?.[0];
  const code = (KNOWN.includes(raw ?? "") ? raw : null) as ActionErrorCode;
  // A chave tecnica `code` (e `metric`/`limit`/`used`/`feature`/...) nunca entra na mensagem.
  const message =
    errors?._form?.[0] ??
    Object.entries(errors ?? {}).filter(([k]) => !TECHNICAL_KEYS.includes(k)).flatMap(([, v]) => v)[0] ??
    (code ? DEFAULT_MESSAGE[code] : undefined) ??
    fallback;
  if (code === "plan_limit") return { code, message, cta: { label: "Fazer upgrade", href: SUBSCRIPTION_HREF } };
  if (code === "plan_feature_locked") {
    // `reason` (069d): "plan" = falta o plano (upgrade); "past_due"/"blocked" = regularizar a assinatura (nao adianta upgrade de plano).
    const upgrade = (errors?.reason?.[0] ?? "plan") === "plan";
    return { code, message, cta: { label: upgrade ? "Fazer upgrade" : "Ver assinatura", href: SUBSCRIPTION_HREF } };
  }
  if (code === "trial_expired") return { code, message: "Seu teste grátis terminou. Assine um plano para continuar.", cta: { label: "Ver assinatura", href: SUBSCRIPTION_HREF } };
  // Politica da plataforma (tenant so le): sem CTA de upgrade; o texto orienta a falar com o administrador.
  return { code, message, cta: null };
}
