/** SPEC-046 — formatação compartilhada pelos templates de e-mail (moeda/data em pt-BR). */
export function formatCentsBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

/** `timeZone: "UTC"` fixo: as datas armazenadas (currentPeriodEnd/canceledAt/purgeDate) são instantes UTC — formatar no fuso local do processo causaria off-by-one dependendo de onde o app roda. */
export function formatDateBR(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}
