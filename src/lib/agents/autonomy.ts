import { createHash } from "node:crypto";

/** Amostragem determinística por lead: mesmo lead+agente => mesma decisão. true = vai para revisão. */
export function inSample(leadId: string, agentId: string, percent: number): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const h = createHash("sha256").update(`${agentId}:${leadId}`).digest().readUInt32BE(0);
  return h % 100 < percent;
}

export type Delivery = "review" | "auto";

export function decideDelivery(a: { role: string; autonomy: "draft" | "sampled" | "auto"; samplePercent: number; autoConfirmedAt: Date | null; disclosureEnabled: boolean }, leadId: string, agentId: string): Delivery {
  if (a.autonomy === "draft") return "review";
  // Closer em auto exige confirmação explícita + aviso de IA ligado; sem isso cai em revisão.
  if (a.role === "closer" && (!a.autoConfirmedAt || !a.disclosureEnabled)) return "review";
  if (a.autonomy === "auto") return "auto";
  return inSample(leadId, agentId, a.samplePercent) ? "review" : "auto";
}
