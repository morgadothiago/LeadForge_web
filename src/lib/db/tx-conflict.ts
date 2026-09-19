/**
 * Detecção de conflito transacional retentável (Serializable) e wrapper de retry (SPEC-013 QA A1).
 * Com o adapter-pg o erro NÃO é PrismaClientKnownRequestError/P2034: chega como `DriverAdapterError`
 * (name "DriverAdapterError", message "TransactionWriteConflict", cause { kind: "TransactionWriteConflict" }).
 * Reconhecemos por estrutura (sem instanceof) para cobrir também P2034 e SQLSTATE 40001/40P01.
 */
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function isRetryableTxConflict(e: unknown, depth = 0): boolean {
  if (!isObj(e) || depth > 3) return false;
  if (e.code === "P2034") return true;
  if (typeof e.code === "string" && RETRYABLE_SQLSTATES.has(e.code)) return true;
  if (e.kind === "TransactionWriteConflict") return true;
  if (e.name === "DriverAdapterError" && e.message === "TransactionWriteConflict") return true;
  if (isObj(e.meta) && typeof e.meta.code === "string" && RETRYABLE_SQLSTATES.has(e.meta.code)) return true;
  return isObj(e.cause) ? isRetryableTxConflict(e.cause, depth + 1) : false;
}

export interface RetryOptions {
  attempts?: number;
  /** Injetável em teste. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const CONFLICT_MESSAGE = "Conflito ao salvar, tente novamente.";

/** Repete `fn` (uma transação inteira por tentativa) em conflito retentável; esgotadas as tentativas relança o último erro. */
export async function withSerializableRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 6;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRetryableTxConflict(e) || attempt >= attempts) throw e;
      await sleep(random() * 25 * attempt + 5 * attempt);
    }
  }
}
