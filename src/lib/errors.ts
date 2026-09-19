/**
 * Erro de aplicação com mensagem segura para o usuário (PT-BR).
 * Clientes HTTP (axios), SMTP e integrações lançam/normalizam para este tipo.
 * `handleActionError` (src/lib/actions/result.ts) exibe `userMessage` no front
 * e loga o detalhe só no servidor. Nunca coloque segredo/corpo cru em `userMessage`.
 */
export type AppErrorCode =
  | "rate_limited"
  | "timeout"
  | "network"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "upstream"
  | "config"
  | "unknown";

export interface AppErrorOptions {
  code: AppErrorCode;
  /** Mensagem em PT-BR, segura para mostrar ao usuário. */
  userMessage: string;
  /** Status HTTP da resposta upstream, se houver. */
  status?: number;
  /** Vale tentar de novo? (429, 5xx, timeout, rede) */
  retryable?: boolean;
  /** Segundos sugeridos para nova tentativa (Retry-After). */
  retryAfterSeconds?: number;
  /** Erro original (só para log no servidor; não exponha). */
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;

  constructor(opts: AppErrorOptions) {
    super(opts.userMessage, { cause: opts.cause });
    this.name = "AppError";
    this.code = opts.code;
    this.userMessage = opts.userMessage;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/**
 * Reduz qualquer erro a um resumo seguro para log: nunca inclui `config`, headers,
 * corpo da resposta nem URL completa (AxiosError cru carrega apikey/Authorization).
 */
export function safeErrorForLog(e: unknown): string {
  if (isAppError(e)) {
    const cause = e.cause ? ` cause=${safeErrorForLog(e.cause)}` : "";
    return `AppError code=${e.code}${e.status ? ` status=${e.status}` : ""}${cause}`;
  }
  if (e && typeof e === "object") {
    const o = e as { name?: unknown; code?: unknown; message?: unknown; response?: { status?: unknown } };
    const parts = [
      typeof o.name === "string" ? o.name : "Error",
      typeof o.code === "string" ? `code=${o.code}` : "",
      typeof o.response?.status === "number" ? `status=${o.response.status}` : "",
      typeof o.message === "string" ? `msg=${o.message.slice(0, 200)}` : "",
    ];
    return parts.filter(Boolean).join(" ");
  }
  return typeof e === "string" ? e.slice(0, 200) : "erro desconhecido";
}
