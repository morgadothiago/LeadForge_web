import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeDelay, createPoller, type PollOutcome } from "./poller";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("computeDelay", () => {
  it("sem falha = intervalo; falhas dobram ate o teto; Retry-After respeitado (com teto)", () => {
    expect(computeDelay(4000, 0, 60000)).toBe(4000);
    expect(computeDelay(4000, 1, 60000)).toBe(8000);
    expect(computeDelay(4000, 3, 60000)).toBe(32000);
    expect(computeDelay(4000, 5, 60000)).toBe(60000);
    expect(computeDelay(4000, 1, 60000, 20000)).toBe(20000);
    expect(computeDelay(4000, 1, 60000, 500000)).toBe(60000);
  });
});

describe("createPoller", () => {
  it("roda na hora e repete a cada intervalo", async () => {
    const task = vi.fn(async (): Promise<PollOutcome> => ({ ok: true }));
    const p = createPoller({ task, intervalMs: 4000 });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(task).toHaveBeenCalledTimes(2);
    p.stop();
    await vi.advanceTimersByTimeAsync(20000);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("aba oculta pausa; onVisible retoma imediatamente", async () => {
    let visible = true;
    const task = vi.fn(async (): Promise<PollOutcome> => ({ ok: true }));
    const p = createPoller({ task, intervalMs: 4000, isVisible: () => visible });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    visible = false;
    await vi.advanceTimersByTimeAsync(60000);
    expect(task).toHaveBeenCalledTimes(1); // oculta: o ciclo agendado nao busca nem se reagenda
    visible = true;
    p.onVisible();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(task).toHaveBeenCalledTimes(3);
    p.stop();
  });

  it("erro faz backoff exponencial e sucesso volta ao intervalo normal", async () => {
    const results: PollOutcome[] = [{ ok: false }, { ok: false }, { ok: true }, { ok: true }];
    const task = vi.fn(async () => results.shift() ?? ({ ok: true } as PollOutcome));
    const p = createPoller({ task, intervalMs: 1000, maxBackoffMs: 60000 });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(task).toHaveBeenCalledTimes(1); // falha 1 => espera 2 s
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(task).toHaveBeenCalledTimes(2); // falha 2 => espera 4 s
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(4); // sucesso: volta a 1 s
    p.stop();
  });

  it("429 com Retry-After espera o tempo pedido", async () => {
    const task = vi.fn(async (): Promise<PollOutcome> => (task.mock.calls.length === 1 ? { ok: false, retryAfterMs: 30000 } : { ok: true }));
    const p = createPoller({ task, intervalMs: 4000 });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(29999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("nunca sobrepoe: trigger durante a requisicao nao abre outra em paralelo", async () => {
    let inflight = 0;
    let maxInflight = 0;
    let release: () => void = () => {};
    const task = vi.fn(
      () =>
        new Promise<PollOutcome>((resolve) => {
          inflight++;
          maxInflight = Math.max(maxInflight, inflight);
          release = () => { inflight--; resolve({ ok: true }); };
        }),
    );
    const p = createPoller({ task, intervalMs: 4000 });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    p.trigger();
    p.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(maxInflight).toBe(1);
    p.stop();
  });

  it("excecao na tarefa conta como falha (nao quebra o ciclo)", async () => {
    const task = vi.fn(async (): Promise<PollOutcome> => { throw new Error("x"); });
    const p = createPoller({ task, intervalMs: 1000 });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.failures).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(task).toHaveBeenCalledTimes(2);
    p.stop();
  });
});
