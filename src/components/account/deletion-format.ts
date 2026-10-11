import type { FieldErrors } from "@/lib/actions/result";

/** SPEC-054b — helpers puros da UI de exclusao de conta. */

const df = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const dtf = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/** DD/MM/AAAA em UTC (mesmo fuso usado nas mensagens do servidor e nos e-mails). Aceita Date ou ISO. */
export function formatDeletionDate(d: Date | string): string {
  return df.format(typeof d === "string" ? new Date(d) : d);
}
export function formatDeletionDateTime(d: Date | string): string {
  return `${dtf.format(typeof d === "string" ? new Date(d) : d)} UTC`;
}

/** Titulo curto por codigo de bloqueio (a mensagem completa vem do servidor). */
export const BLOCKER_TITLES: Record<string, string> = {
  active_subscription: "Assinatura ativa",
  last_owner_with_members: "Único proprietário de uma organização com membros",
  platform_admin: "Conta de administrador da plataforma",
  no_password: "Conta sem senha definida",
};
export function blockerTitle(code: string): string {
  return BLOCKER_TITLES[code] ?? "Exclusão bloqueada";
}

/** Codigo estavel (`errors.code[0]`) de um `ActionResult` de falha. */
export function errorCode(errors: FieldErrors | undefined): string | undefined {
  return errors?.code?.[0];
}

/** Mensagem geral de uma falha de action de exclusao (so `_form`; nunca os codigos tecnicos). */
export function deletionErrorMessage(errors: FieldErrors | undefined, fallback = "Não foi possível concluir a operação. Tente novamente."): string {
  return errors?._form?.join(" ") || fallback;
}
