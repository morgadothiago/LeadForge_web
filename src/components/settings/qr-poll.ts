/** Máquina de estados (pura) do polling de conexão do QR code. */
export type QrPhase = "loading" | "waiting" | "connected" | "expired" | "failed" | "exhausted";

export interface QrPollState {
  phase: QrPhase;
  attempts: number;
  errorStreak: number;
  qrAt: number | null;
  message: string | null;
}

export type QrPollEvent =
  | { type: "qrLoaded"; now: number }
  | { type: "qrFailed"; message: string }
  | { type: "statusChecked"; status: "connected" | "connecting" | "disconnected"; now: number }
  | { type: "statusFailed"; message: string };

export const BASE_DELAY_MS = 3000;
export const MAX_DELAY_MS = 10_000;
export const MAX_ATTEMPTS = 60;
export const MAX_ERROR_STREAK = 3;
export const QR_TTL_MS = 60_000;

export const initialQrPollState: QrPollState = { phase: "loading", attempts: 0, errorStreak: 0, qrAt: null, message: null };

/** ~3s nas primeiras tentativas, cresce 25% por tentativa após 5, teto 10s; erros consecutivos dobram o intervalo. */
export function nextPollDelay(attempts: number, errorStreak = 0): number {
  const growth = Math.max(0, attempts - 5);
  const base = Math.min(MAX_DELAY_MS, Math.round(BASE_DELAY_MS * 1.25 ** growth));
  return Math.min(MAX_DELAY_MS, base * 2 ** Math.min(errorStreak, 2));
}

export const shouldPoll = (s: QrPollState): boolean => s.phase === "waiting";

export function qrPollReducer(s: QrPollState, e: QrPollEvent): QrPollState {
  switch (e.type) {
    case "qrLoaded":
      return { phase: "waiting", attempts: 0, errorStreak: 0, qrAt: e.now, message: null };
    case "qrFailed":
      return { ...s, phase: "failed", message: e.message };
    case "statusChecked": {
      if (s.phase !== "waiting") return s;
      if (e.status === "connected") return { ...s, phase: "connected", errorStreak: 0, message: null };
      const attempts = s.attempts + 1;
      if (s.qrAt !== null && e.now - s.qrAt >= QR_TTL_MS) return { ...s, phase: "expired", attempts, errorStreak: 0 };
      if (attempts >= MAX_ATTEMPTS) return { ...s, phase: "exhausted", attempts, errorStreak: 0 };
      return { ...s, attempts, errorStreak: 0 };
    }
    case "statusFailed": {
      if (s.phase !== "waiting") return s;
      const attempts = s.attempts + 1;
      const errorStreak = s.errorStreak + 1;
      if (errorStreak >= MAX_ERROR_STREAK) return { ...s, phase: "failed", attempts, errorStreak, message: e.message };
      if (attempts >= MAX_ATTEMPTS) return { ...s, phase: "exhausted", attempts, errorStreak, message: e.message };
      return { ...s, attempts, errorStreak, message: e.message };
    }
  }
}
