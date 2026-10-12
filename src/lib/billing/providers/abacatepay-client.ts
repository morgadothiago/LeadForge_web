import axios, { type AxiosInstance } from "axios";
import { isAppError } from "@/lib/errors";
import { describeUpstreamError } from "./abacatepay-errors";

/**
 * SPEC-063 (D-063-23) — wrapper fino sobre o cliente HTTP compartilhado: em erro HTTP, registra UMA linha
 * `[abacatepay] <METODO> <path> -> <status> <corpo mascarado/truncado>` (sem corpo da requisicao, sem headers, sem query) e
 * relanca o MESMO `AppError` ja normalizado (codigos/mensagens ao usuario nao mudam aqui — ver D-063-24 em `actions/billing.ts`).
 * Nao altera `normalizeError`/`safeErrorForLog` globais (outras integracoes podem devolver PII no corpo).
 */
export interface RequestOptions {
  params?: Record<string, string | number | undefined>;
  data?: unknown;
  /** So GET/idempotentes sao repetidos pelo cliente; POST de criacao NUNCA (corpo nao idempotente comprovado). */
  idempotent?: boolean;
}

export class AbacateClient {
  constructor(
    private readonly http: AxiosInstance,
    private readonly secrets: () => ReadonlyArray<string | undefined>,
    private readonly log: (line: string) => void = (l) => console.error(l),
  ) {}

  async request<T = unknown>(method: "GET" | "POST", path: string, opts: RequestOptions = {}): Promise<T> {
    try {
      const res = await this.http.request({ method, url: path, params: opts.params, data: opts.data, idempotent: opts.idempotent });
      return res.data as T;
    } catch (e) {
      const cause = isAppError(e) ? e.cause : e;
      if (axios.isAxiosError(cause) && cause.response) {
        this.log(describeUpstreamError({ method, url: path, status: cause.response.status, body: cause.response.data, secrets: this.secrets() }));
      } else if (axios.isAxiosError(cause)) {
        this.log(`[abacatepay] ${method} ${path.split("?")[0]} -> sem-resposta ${cause.code ?? ""}`.trim());
      }
      throw e;
    }
  }

  get<T = unknown>(path: string, params?: RequestOptions["params"]): Promise<T> {
    return this.request<T>("GET", path, { params });
  }
  post<T = unknown>(path: string, data: unknown): Promise<T> {
    return this.request<T>("POST", path, { data });
  }
}
