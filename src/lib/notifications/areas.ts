/**
 * SPEC-028: mapa PURO kind de alerta -> area do web (sem I/O). Kind desconhecido nao pertence a nenhuma area (conta so no total).
 * `aprovacoes` nao vem de alertas (e a fila de Draft pendentes); por isso nenhum kind aponta para ela.
 */
export const AREAS = ["calendario", "leads", "configuracoes", "aprovacoes"] as const;
export type Area = (typeof AREAS)[number];

export const KIND_AREA: Readonly<Record<string, Area>> = {
  meeting_reminder: "calendario",
  handoff: "leads",
  lead_replied: "leads",
  wa_disconnected: "configuracoes",
  wa_paused: "configuracoes",
  scheduler_stale: "configuracoes",
  budget_alert: "configuracoes",
  budget_exhausted: "configuracoes",
  mass_opt_out: "configuracoes",
};

export const isArea = (v: unknown): v is Area => typeof v === "string" && (AREAS as readonly string[]).includes(v);

export function areaOfKind(kind: string): Area | null {
  return Object.prototype.hasOwnProperty.call(KIND_AREA, kind) ? KIND_AREA[kind] : null;
}

export function kindsOfArea(area: Area): string[] {
  return Object.entries(KIND_AREA).filter(([, a]) => a === area).map(([k]) => k);
}

/** Agrega contagens por kind em contagens por area; kinds sem area entram so no total. */
export function summarizeByKind(rows: { kind: string; count: number }[]): { unreadTotal: number; byArea: Record<Exclude<Area, "aprovacoes">, number> } {
  const byArea = { calendario: 0, leads: 0, configuracoes: 0 };
  let unreadTotal = 0;
  for (const r of rows) {
    unreadTotal += r.count;
    const a = areaOfKind(r.kind);
    if (a && a !== "aprovacoes") byArea[a] += r.count;
  }
  return { unreadTotal, byArea };
}
