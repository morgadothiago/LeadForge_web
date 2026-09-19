import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig, type InternalAxiosRequestConfig } from "axios";
import { AppError } from "@/lib/errors";
import { messageFor } from "./messages";
import { redactHeaders, redactUrl } from "./redact";

export interface RetryOptions {
  /** Máximo de tentativas TOTAIS (default 3). */
  maxAttempts?: number;
  /** Base do backoff em ms (default 500). */
  baseDelayMs?: number;
  /** Teto de espera em ms, inclusive para Retry-After (default 30000). */
  maxDelayMs?: number;
  /** Injetável para testes. */
  sleep?: (ms: number) => Promise<void>;
  /** Injetável para testes (default Math.random). */
  random?: () => number;
}

export interface HttpClientOptions {
  /** Nome da integração exibido ao usuário, ex.: "WhatsApp (Evolution)". */
  name: string;
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
  retry?: RetryOptions | false;
  adapter?: AxiosRequestConfig["adapter"];
  /** Agents (ex.: conexão fixada no IP já checado contra SSRF) e limite de redirecionamentos (0 = nenhum). */
  httpAgent?: AxiosRequestConfig["httpAgent"];
  httpsAgent?: AxiosRequestConfig["httpsAgent"];
  maxRedirects?: number;
  /** Logger sem segredos (default console.warn). */
  logger?: (msg: string, meta: Record<string, unknown>) => void;
}

declare module "axios" {
  interface AxiosRequestConfig {
    /** Permite retry de método não idempotente (chave de idempotência garantida pelo chamador). */
    idempotent?: boolean;
  }
}

const IDEMPOTENT = new Set(["get", "head", "put", "delete", "options"]);
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function parseRetryAfter(value: unknown, now = Date.now()): number | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.ceil(Number(s));
  const t = Date.parse(s);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, Math.ceil((t - now) / 1000));
}

interface RetryState {
  attempt: number;
}

export function normalizeError(err: unknown, name: string): AppError {
  if (err instanceof AppError) return err;
  if (axios.isCancel(err)) {
    return new AppError({ code: "unknown", userMessage: `A requisição para ${name} foi cancelada.`, cause: err });
  }
  if (!axios.isAxiosError(err)) {
    return new AppError({ code: "unknown", userMessage: messageFor("unknown", name), cause: err });
  }
  const e = err as AxiosError;
  const status = e.response?.status;
  if (!e.response) {
    const c = e.code;
    if (c === "ECONNABORTED" || c === "ETIMEDOUT") {
      return new AppError({ code: "timeout", userMessage: messageFor("timeout", name), retryable: true, cause: err });
    }
    return new AppError({ code: "network", userMessage: messageFor("network", name), retryable: true, cause: err });
  }
  const st = status as number;
  const mk = (code: Parameters<typeof messageFor>[0], retryable = false, retryAfterSeconds?: number) =>
    new AppError({ code, userMessage: messageFor(code, name, retryAfterSeconds), status: st, retryable, retryAfterSeconds, cause: err });
  if (st === 429) return mk("rate_limited", true, parseRetryAfter(e.response.headers?.["retry-after"]));
  if (st === 408) return mk("timeout", true);
  if (st === 400 || st === 422) return mk("validation");
  if (st === 401) return mk("unauthorized");
  if (st === 403) return mk("forbidden");
  if (st === 404) return mk("not_found");
  if (st === 409) return mk("conflict");
  if (st >= 500) return mk("upstream", true);
  return mk("unknown");
}

export function createHttpClient(opts: HttpClientOptions): AxiosInstance {
  const { name } = opts;
  const r = opts.retry === false ? null : (opts.retry ?? {});
  const maxAttempts = r?.maxAttempts ?? 3;
  const base = r?.baseDelayMs ?? 500;
  const cap = r?.maxDelayMs ?? 30_000;
  const sleep = r?.sleep ?? defaultSleep;
  const random = r?.random ?? Math.random;
  const log = opts.logger ?? ((m, meta) => console.warn(m, meta));

  const client = axios.create({
    baseURL: opts.baseURL,
    timeout: opts.timeout ?? 15_000,
    headers: opts.headers,
    adapter: opts.adapter,
    httpAgent: opts.httpAgent,
    httpsAgent: opts.httpsAgent,
    ...(opts.maxRedirects !== undefined ? { maxRedirects: opts.maxRedirects } : {}),
  });

  client.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
    (cfg as InternalAxiosRequestConfig & { __retry?: RetryState }).__retry ??= { attempt: 0 };
    return cfg;
  });

  client.interceptors.response.use(undefined, async (error: unknown) => {
    const appErr = normalizeError(error, name);
    const cfg = (axios.isAxiosError(error) ? error.config : undefined) as
      | (InternalAxiosRequestConfig & { __retry?: RetryState })
      | undefined;
    if (!r || !cfg || !appErr.retryable) throw appErr;
    const method = (cfg.method ?? "get").toLowerCase();
    if (!IDEMPOTENT.has(method) && cfg.idempotent !== true) throw appErr;
    const state = (cfg.__retry ??= { attempt: 0 });
    state.attempt += 1;
    if (state.attempt >= maxAttempts) throw appErr;

    let delay: number;
    if (appErr.retryAfterSeconds != null) delay = Math.min(appErr.retryAfterSeconds * 1000, cap);
    else delay = Math.min(cap, base * 2 ** (state.attempt - 1) * (0.5 + random() * 0.5));
    log(`[http:${name}] retry ${state.attempt}/${maxAttempts - 1}`, {
      code: appErr.code,
      status: appErr.status,
      method,
      url: redactUrl(cfg.url),
      headers: redactHeaders(cfg.headers),
      delayMs: Math.round(delay),
    });
    await sleep(delay);
    return client.request(cfg);
  });

  return client;
}
