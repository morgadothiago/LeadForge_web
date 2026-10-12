import { redirect } from "next/navigation";
import { loadAccountStage, resolveStageRoute, type AccountStage } from "./account-stage";
import { requireUser, UnauthorizedError, type CurrentUser } from "./require-user";

/**
 * SPEC-062b — guarda das telas do usuario SEM organizacao (`/assinar`, `/assinar/retorno`, `/organizacao/nova`,
 * `/entrar-em-organizacao`, `/minha-conta`). Cada pagina declara os estados em que renderiza; qualquer outro vai ao destino
 * do estado (`resolveStageRoute`, unica fonte). `stageGuardTarget` e pura (testavel por tabela); `requireStagePage` e o wrapper
 * de servidor. Sem laco: o destino de cada estado esta SEMPRE na lista de permitidos da propria rota (ver stage-guard.test.ts).
 */
export function stageGuardTarget(stage: AccountStage, allowed: readonly AccountStage[], overrides: Partial<Record<AccountStage, string>> = {}): string | null {
  if (allowed.includes(stage)) return null;
  return overrides[stage] ?? resolveStageRoute(stage);
}

const ALL_PROVIDER: readonly AccountStage[] = ["sem_plano", "aguardando_pagamento", "pago_sem_org", "dono", "membro", "membro_pago_sem_org"];

/** Estados em que cada tela renderiza (D-062-6 "Pode acessar"). Fonte unica das paginas E do teste de "sem laco". */
export const STAGE_RULES = {
  /** Casca paga (mesmo com org) nunca abre 2o checkout: vai finalizar a organizacao. */
  "/assinar": { allowed: ["sem_plano", "aguardando_pagamento"] as readonly AccountStage[], overrides: { membro_pago_sem_org: "/organizacao/nova" } as Partial<Record<AccountStage, string>> },
  /** `?nova=1` (2a organizacao, D-062-14): dono/membro tambem entram. */
  "/assinar?nova=1": { allowed: ["sem_plano", "aguardando_pagamento", "dono", "membro"] as readonly AccountStage[], overrides: { membro_pago_sem_org: "/organizacao/nova" } as Partial<Record<AccountStage, string>> },
  "/assinar/retorno": { allowed: ALL_PROVIDER, overrides: {} as Partial<Record<AccountStage, string>> },
  "/organizacao/nova": { allowed: ["pago_sem_org", "membro_pago_sem_org"] as readonly AccountStage[], overrides: {} as Partial<Record<AccountStage, string>> },
  "/entrar-em-organizacao": { allowed: ALL_PROVIDER, overrides: {} as Partial<Record<AccountStage, string>> },
  "/minha-conta": {
    allowed: ["sem_plano", "aguardando_pagamento", "pago_sem_org"] as readonly AccountStage[],
    overrides: { dono: "/configuracoes/conta", membro: "/configuracoes/conta", membro_pago_sem_org: "/configuracoes/conta" } as Partial<Record<AccountStage, string>>,
  },
} as const;
export type StageRoute = keyof typeof STAGE_RULES;

export interface StagePageContext {
  user: CurrentUser;
  stage: AccountStage;
  pendingSetup: boolean;
}

export async function requireStagePage(allowed: readonly AccountStage[], overrides: Partial<Record<AccountStage, string>> = {}): Promise<StagePageContext> {
  let user: CurrentUser;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect("/login");
    throw e;
  }
  const loaded = await loadAccountStage(user.id, user.platformRole);
  const target = stageGuardTarget(loaded.stage, allowed, overrides);
  if (target) redirect(target);
  return { user, stage: loaded.stage, pendingSetup: loaded.pendingSetup };
}

export function requireStageRoute(route: StageRoute): Promise<StagePageContext> {
  return requireStagePage(STAGE_RULES[route].allowed, STAGE_RULES[route].overrides);
}

/** Primeiro valor de um searchParam (string | string[] | undefined). */
export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
