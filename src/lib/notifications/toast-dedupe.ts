/** SPEC-029: dedupe de toasts por id de notificacao em sessionStorage (so ids; nada sensivel). */
export const TOAST_STORAGE_KEY = "lf:toasted-notifications";
const MAX_IDS = 200;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function read(storage: StorageLike | null): string[] {
  try {
    const v = JSON.parse(storage?.getItem(TOAST_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Devolve so os ids ainda nao avisados e os registra. Sem storage (SSR/privado) nunca repete dentro da mesma chamada. */
export function claimToastIds(ids: string[], storage: StorageLike | null): string[] {
  const seen = new Set(read(storage));
  const fresh = [...new Set(ids)].filter((id) => !seen.has(id));
  if (fresh.length) {
    try {
      storage?.setItem(TOAST_STORAGE_KEY, JSON.stringify([...seen, ...fresh].slice(-MAX_IDS)));
    } catch {
      /* storage cheio/bloqueado */
    }
  }
  return fresh;
}
