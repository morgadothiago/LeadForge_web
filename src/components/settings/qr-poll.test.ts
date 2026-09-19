import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, QR_TTL_MS, initialQrPollState, nextPollDelay, qrPollReducer, shouldPoll, type QrPollState } from "./qr-poll";

const waiting = (over: Partial<QrPollState> = {}): QrPollState => ({ ...qrPollReducer(initialQrPollState, { type: "qrLoaded", now: 0 }), ...over });

describe("qr-poll", () => {
  it("backoff: 3s no início, cresce e respeita teto", () => {
    expect(nextPollDelay(0)).toBe(3000);
    expect(nextPollDelay(5)).toBe(3000);
    expect(nextPollDelay(8)).toBeGreaterThan(3000);
    expect(nextPollDelay(100)).toBe(10_000);
    expect(nextPollDelay(0, 1)).toBe(6000);
    expect(nextPollDelay(0, 5)).toBe(10_000);
  });
  it("qrLoaded -> waiting e polling ativo", () => {
    expect(shouldPoll(waiting())).toBe(true);
    expect(shouldPoll(initialQrPollState)).toBe(false);
  });
  it("conectado para o polling", () => {
    const s = qrPollReducer(waiting(), { type: "statusChecked", status: "connected", now: 1000 });
    expect(s.phase).toBe("connected");
    expect(shouldPoll(s)).toBe(false);
  });
  it("continua enquanto conectando; expira após TTL", () => {
    const s1 = qrPollReducer(waiting(), { type: "statusChecked", status: "connecting", now: 3000 });
    expect(s1.phase).toBe("waiting");
    expect(s1.attempts).toBe(1);
    expect(qrPollReducer(s1, { type: "statusChecked", status: "disconnected", now: QR_TTL_MS }).phase).toBe("expired");
  });
  it("teto de tentativas", () => {
    const s = qrPollReducer(waiting({ attempts: MAX_ATTEMPTS - 1 }), { type: "statusChecked", status: "connecting", now: 1 });
    expect(s.phase).toBe("exhausted");
  });
  it("3 erros seguidos falham sem laço; sucesso zera a sequência", () => {
    let s = waiting();
    s = qrPollReducer(s, { type: "statusFailed", message: "429" });
    s = qrPollReducer(s, { type: "statusFailed", message: "429" });
    expect(s.phase).toBe("waiting");
    expect(qrPollReducer(s, { type: "statusChecked", status: "connecting", now: 1 }).errorStreak).toBe(0);
    s = qrPollReducer(s, { type: "statusFailed", message: "429" });
    expect(s.phase).toBe("failed");
    expect(s.message).toBe("429");
  });
  it("qrFailed -> failed; eventos fora de waiting são ignorados", () => {
    const f = qrPollReducer(initialQrPollState, { type: "qrFailed", message: "erro" });
    expect(f.phase).toBe("failed");
    expect(qrPollReducer(f, { type: "statusChecked", status: "connected", now: 1 })).toBe(f);
  });
});
