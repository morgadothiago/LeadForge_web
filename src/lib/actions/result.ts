import { Prisma } from "@prisma/client";
import type { ZodError } from "zod";
import { ForbiddenError } from "@/lib/auth/require-admin";
import { UnauthorizedError } from "@/lib/auth/require-user";
import { isRetryableTxConflict, CONFLICT_MESSAGE } from "@/lib/db/tx-conflict";
import { isAppError, safeErrorForLog } from "@/lib/errors";

/** Erros por campo (chave = path com ponto, ex.: "icp.name"); "_form" p/ erro geral. */
export type FieldErrors = Record<string, string[]>;

export type ActionResult<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

export function success<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function failure<T = never>(errors: FieldErrors): ActionResult<T> {
  return { ok: false, errors };
}

export function formError<T = never>(message: string): ActionResult<T> {
  return { ok: false, errors: { _form: [message] } };
}

export function zodErrors(error: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/**
 * Converte qualquer erro lançado numa action em ActionResult PT-BR, sem vazar mensagem interna.
 * UnauthorizedError -> sessão expirada; Prisma P2025 -> não encontrado; P2003/P2002 -> conflito;
 * demais -> erro genérico (detalhe apenas em console.error no servidor).
 */
export function handleActionError<T = never>(e: unknown): ActionResult<T> {
  if (e instanceof UnauthorizedError) return formError("Sessão expirada. Faça login novamente.");
  if (e instanceof ForbiddenError) return formError("Sem permissão.");
  if (isAppError(e)) {
    console.error("[action]", safeErrorForLog(e));
    return formError(e.userMessage);
  }
  if (isRetryableTxConflict(e)) return formError(CONFLICT_MESSAGE);
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2025") return formError("Registro não encontrado.");
    if (e.code === "P2003") return formError("Operação inválida: há registros relacionados ou referência inexistente.");
    if (e.code === "P2002") return formError("Já existe um registro com esses dados.");
  }
  console.error("[action] erro inesperado:", safeErrorForLog(e));
  return formError("Não foi possível concluir a operação. Tente novamente.");
}

/**
 * Executa o corpo de uma server action capturando exceções via handleActionError.
 * Uso (em arquivos "use server", chame dentro de função async exportada):
 *   export async function foo(x: unknown) { return safeAction(async () => { ... return success(d); }); }
 */
export async function safeAction<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    return handleActionError<T>(e);
  }
}
