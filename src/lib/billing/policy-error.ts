/**
 * SPEC-069c (D-069-2) — o tenant (owner/member) NAO edita POLITICA (modelo, teto de custo, mensagens/dia, turnos, chave da plataforma, kill switch
 * travado): isso e do `platform_admin`. Erro tipado que `handleActionError` converte em `errors._form` PT-BR + `code: ["policy_admin_only"]` + `fields`.
 * PURO (sem prisma/next) para poder ser importado por `result.ts` sem ciclo.
 */
export const POLICY_FIELD_LABELS = {
  model: "modelo de IA",
  monthlyBudgetCents: "teto de custo mensal",
  dailyMessageLimit: "mensagens por dia",
  maxTurnsPerLead: "turnos por lead",
  killSwitch: "kill switch (travado pela plataforma)",
  integration: "chave de integração da plataforma",
} as const;
export type PolicyField = keyof typeof POLICY_FIELD_LABELS;

export class PolicyManagedByAdminError extends Error {
  readonly code = "policy_admin_only" as const;
  constructor(readonly fields: readonly PolicyField[]) {
    const names = fields.map((f) => POLICY_FIELD_LABELS[f]).join(", ");
    super(`Definido pela plataforma: ${names}. Apenas o administrador da plataforma altera este valor; peça a ele ou fale com o suporte.`);
    this.name = "PolicyManagedByAdminError";
  }
}
