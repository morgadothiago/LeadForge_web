import type { RawLead } from "./types";

/** Score determinístico 0-100 (sem LLM): contato e presença digital pesam mais que reputação. */
export function scoreLead(l: RawLead): number {
  let s = 0;
  if (l.phone) s += 35;
  if (l.email) s += 25;
  if (l.website) s += 20;
  if (l.rating != null) s += Math.round((Math.min(Math.max(l.rating, 0), 5) / 5) * 10);
  if (l.ratingCount != null) s += Math.min(10, Math.round(Math.log10(l.ratingCount + 1) * 4));
  return Math.min(100, Math.max(0, s));
}
