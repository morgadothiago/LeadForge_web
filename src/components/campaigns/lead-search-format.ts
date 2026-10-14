import type { LeadSearchPanel } from "@/lib/queries/lead-search";

export const POLL_INTERVAL_MS = 3_000;
/** Depois disso a UI para de acompanhar e avisa que a busca continua em segundo plano. */
export const UI_MAX_WAIT_MS = 120_000;
export const DISABLED_TEXT = "Busca de leads indisponível no momento, fale com o suporte.";

export type ManagePanel = Extract<LeadSearchPanel, { canManage: true }>;
export type BlockKind = "disabled" | "member" | "nokey" | "inactive" | "budget";
export interface Block { kind: BlockKind; message: string }

const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;

/** Primeiro impedimento (ordem de prioridade) para disparar a busca; null = liberado. Nunca cita variável de ambiente. */
export function deriveBlock(panel: ManagePanel, campaignActive: boolean): Block | null {
  if (!panel.enabled) return { kind: "disabled", message: DISABLED_TEXT };
  if (panel.role !== "owner") return { kind: "member", message: "Apenas o proprietário da organização pode iniciar buscas. Você pode acompanhar o histórico abaixo." };
  if (!panel.hasKey) return { kind: "nokey", message: "A busca de leads ainda não está disponível: o serviço é gerenciado pela plataforma. Fale com o suporte." };
  if (!campaignActive) return { kind: "inactive", message: "A campanha precisa estar ativa para buscar leads." };
  if (panel.remainingManual <= 0) return { kind: "budget", message: `Limite de buscas manuais desta campanha atingido hoje (${panel.manualBudget} por dia). Tente amanhã.` };
  if (panel.remainingOrg <= 0) return { kind: "budget", message: `Limite de buscas da organização atingido hoje (${panel.orgBudget} chamadas por dia). Tente amanhã.` };
  return null;
}

export function estimateText(panel: ManagePanel): string {
  const manual = panel.remainingManual === 1 ? "Resta 1 busca manual hoje" : `Restam ${panel.remainingManual} buscas manuais hoje`;
  return `${manual} (${n(panel.remainingOrg, "chamada paga", "chamadas pagas")} na conta). Cada busca = 1 chamada Places Text Search; preço por chamada depende do seu plano Google (não exibimos valor em R$).`;
}

export function confirmCostText(panel: ManagePanel): string {
  return `Esta busca usa 1 chamada paga; ${panel.estimatedPaidCallsLeft === 1 ? "resta 1" : `restam ${panel.estimatedPaidCallsLeft}`} hoje.`;
}

export interface Counts { created: number; duplicate: number; suppressed: number; invalid: number }

export function resultText(c: Counts): string {
  return `${n(c.created, "novo", "novos")}, ${n(c.duplicate, "duplicado", "duplicados")}, ${n(c.suppressed, "suprimido", "suprimidos")} (${n(c.invalid, "inválido", "inválidos")})`;
}

export const DUPLICATES_HINT = "Repetir a busca tende a trazer resultados duplicados: empresas já encontradas não entram de novo.";
export const BACKGROUND_TEXT = "A busca continua em segundo plano. Atualize a página mais tarde para ver o resultado no histórico.";
export const NEXT_PAGE_HINT = "Há mais resultados para esta busca: cada nova busca continua de onde a anterior parou e usa 1 a 2 chamadas pagas.";
