import type { InstanceHealth } from "@prisma/client";

/** Teto máximo do limite diário (espelha DAILY_LIMIT_MAX do backend). */
export const DAILY_LIMIT_MAX_UI = 40;
export const DAILY_LIMIT_MIN_UI = 1;

/** Rampa de aquecimento em texto (SPEC-017): o limite configurado é o TETO, não o valor de hoje. */
export const WARMUP_RAMP: ReadonlyArray<{ period: string; limit: number | "teto" }> = [
  { period: "Dias 1 a 3", limit: 3 },
  { period: "Dias 4 a 7", limit: 6 },
  { period: "Semana 2 (dias 8 a 14)", limit: 12 },
  { period: "Semana 3 (dias 15 a 21)", limit: 20 },
  { period: "Semana 4 em diante", limit: "teto" },
];

export function warmupRampText(ceiling: number = DAILY_LIMIT_MAX_UI): string {
  return WARMUP_RAMP.map((r) => `${r.period}: ${r.limit === "teto" ? `até ${ceiling}` : r.limit}`).join("; ");
}

/** Valida o teto diário no cliente (1 a 40, inteiro). Devolve mensagem ou null. */
export function validateDailyLimit(raw: string): string | null {
  const v = raw.trim();
  if (!/^\d+$/.test(v)) return "Informe um número inteiro.";
  const n = Number(v);
  if (n < DAILY_LIMIT_MIN_UI) return `Limite diário mínimo é ${DAILY_LIMIT_MIN_UI}.`;
  if (n > DAILY_LIMIT_MAX_UI) return `Limite diário máximo é ${DAILY_LIMIT_MAX_UI} (política anti-banimento).`;
  return null;
}

export interface HealthStateInfo {
  label: string;
  description: string;
  tone: "ok" | "warn" | "off";
}

export const HEALTH_STATE_INFO: Record<InstanceHealth, HealthStateInfo> = {
  good: { label: "Saudável", description: "Envios normais, seguindo a rampa de aquecimento.", tone: "ok" },
  warning: { label: "Atenção", description: "Sinais de risco: a rampa desce um degrau até a saúde melhorar.", tone: "warn" },
  paused: { label: "Pausada", description: "Envios suspensos automaticamente para proteger o número.", tone: "off" },
};

/** Percentual inteiro 0-100 do uso diário; limite 0 => 0. */
export function usagePercent(sent: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((sent / limit) * 100)));
}

/** "5 de 12 hoje" / "Sem envios liberados hoje". */
export function usageText(sent: number, limit: number): string {
  return limit <= 0 ? `${sent} enviadas hoje; nenhum envio liberado agora` : `${sent} de ${limit} enviadas hoje`;
}

/** "Dia 3 de aquecimento" / "Aquecimento ainda não iniciado". */
export function warmupText(day: number | null): string {
  return day === null ? "Aquecimento ainda não iniciado (conecte o número)" : `Dia ${day} de aquecimento`;
}

/** Limite efetivo vs teto: deixa claro que o teto não é o valor de hoje. */
export function limitExplanation(effective: number, ceiling: number): string {
  if (effective <= 0) return `Teto configurado: ${ceiling}. Hoje: 0 (instância pausada).`;
  if (effective >= ceiling) return `Teto configurado: ${ceiling}. Hoje você já está no teto.`;
  return `Teto configurado: ${ceiling}. Hoje o limite é ${effective} porque o número ainda está em aquecimento.`;
}

/** Taxa 0-1 -> "85%"; null => "dados insuficientes" (amostra mínima não atingida). */
export function formatRate(rate: number | null): string {
  return rate === null ? "dados insuficientes" : `${Math.round(rate * 1000) / 10}%`.replace(".", ",");
}

export function pausedText(pausedUntil: Date | null, reason: string | null, formatDate: (d: Date) => string): string {
  const until = pausedUntil ? ` até ${formatDate(pausedUntil)}` : "";
  return `Pausada${until}${reason ? ` por: ${reason}` : ""}`;
}
