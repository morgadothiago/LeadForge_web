import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PLAYBACK_ERRORS, MAX_NOT_FOUND, MAX_POLL_ERRORS, MAX_URL_RETRIES, createPollController, createUrlRenewer, createWizardSubmitter, planResume, videoPanelState, type PollStatus } from "./creative-lifecycle";

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (m = "erro") => ({ ok: false as const, errors: { _form: [m] } });
const flush = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function pollSetup(fetchImpl: () => Promise<ReturnType<typeof ok> | ReturnType<typeof fail>>) {
  let visible = true;
  let listener: (() => void) | undefined;
  const fetch = vi.fn(fetchImpl);
  const statuses: PollStatus[] = [];
  const onData = vi.fn();
  const ctrl = createPollController<{ s: string }>({
    fetch: fetch as never,
    isDone: (d) => d.s === "ready",
    onData,
    onStatus: (s) => statuses.push(s),
    isVisible: () => visible,
    subscribeVisibility: (cb) => {
      listener = cb;
      return () => (listener = undefined);
    },
  });
  return {
    ctrl,
    fetch,
    statuses,
    onData,
    setVisible(v: boolean) {
      visible = v;
      listener?.();
    },
    hasListener: () => listener !== undefined,
  };
}

describe("polling", () => {
  it("para ao chegar em estado terminal", async () => {
    const seq = [{ s: "queued" }, { s: "processing" }, { s: "ready" }];
    const p = pollSetup(async () => ok(seq.shift()!));
    p.ctrl.start();
    await flush(60_000);
    expect(p.fetch).toHaveBeenCalledTimes(3);
    expect(p.statuses.at(-1)).toBe("done");
    expect(p.hasListener()).toBe(false);
  });
  it("sobrevive a rejeição (exceção) com backoff e recupera", async () => {
    let n = 0;
    const p = pollSetup(async () => {
      if (++n <= 2) throw new Error("rede");
      return ok({ s: "processing" });
    });
    p.ctrl.start();
    await flush(6000);
    expect(p.fetch).toHaveBeenCalledTimes(1);
    await flush(11_999); // backoff 12 s
    expect(p.fetch).toHaveBeenCalledTimes(1);
    await flush(2);
    expect(p.fetch).toHaveBeenCalledTimes(2);
    await flush(20_000);
    expect(p.fetch).toHaveBeenCalledTimes(3);
    expect(p.onData).toHaveBeenCalled();
    expect(p.statuses).toContain("retrying");
  });
  it("desiste após erros consecutivos demais", async () => {
    const p = pollSetup(async () => fail("falha"));
    p.ctrl.start();
    await flush(10 * 60_000);
    expect(p.fetch).toHaveBeenCalledTimes(MAX_POLL_ERRORS);
    expect(p.statuses.at(-1)).toBe("gave_up");
  });
  it("criativo não encontrado persistente para o polling", async () => {
    const p = pollSetup(async () => fail("Criativo não encontrado."));
    p.ctrl.start();
    await flush(10 * 60_000);
    expect(p.fetch).toHaveBeenCalledTimes(2);
    expect(p.statuses.at(-1)).toBe("gone");
  });
  it("resposta ok zera o contador de não encontrado consecutivo", async () => {
    let n = 0;
    const p = pollSetup(async () => (++n % 2 ? fail("Criativo não encontrado.") : ok({ s: "processing" })));
    p.ctrl.start();
    await flush(5 * 60_000);
    expect(p.fetch.mock.calls.length).toBeGreaterThan(MAX_NOT_FOUND + 2);
    expect(p.statuses).not.toContain("gone");
    p.ctrl.stop();
  });
  it("aba oculta não chama o servidor; ao voltar faz refresh imediato", async () => {
    const p = pollSetup(async () => ok({ s: "processing" }));
    p.ctrl.start();
    p.setVisible(false);
    await flush(120_000);
    expect(p.fetch).not.toHaveBeenCalled();
    p.setVisible(true);
    await flush(0);
    expect(p.fetch).toHaveBeenCalledTimes(1);
  });
  it("stop limpa timers e listener", async () => {
    const p = pollSetup(async () => ok({ s: "processing" }));
    p.ctrl.start();
    p.ctrl.stop();
    await flush(120_000);
    expect(p.fetch).not.toHaveBeenCalled();
    expect(p.hasListener()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stop durante requisição em voo não reagenda nem entrega dados", async () => {
    let resolve!: (v: unknown) => void;
    const p = pollSetup(() => new Promise((r) => (resolve = r)) as never);
    p.ctrl.start();
    await flush(6000);
    p.ctrl.stop();
    resolve(ok({ s: "processing" }));
    await flush(60_000);
    expect(p.onData).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("restart zera erros e consulta já", async () => {
    let fail1 = true;
    const p = pollSetup(async () => (fail1 ? fail() : ok({ s: "ready" })));
    p.ctrl.start();
    await flush(10 * 60_000);
    expect(p.statuses.at(-1)).toBe("gave_up");
    fail1 = false;
    p.ctrl.restart();
    await flush(0);
    expect(p.statuses.at(-1)).toBe("done");
  });
});

describe("videoPanelState", () => {
  it("decide o painel", () => {
    expect(videoPanelState({ loading: false })).toBe("loading");
    expect(videoPanelState({ loading: true })).toBe("loading");
    expect(videoPanelState({ url: "u", loading: false })).toBe("player");
    expect(videoPanelState({ error: "x", loading: false })).toBe("error");
    expect(videoPanelState({ url: "u", error: "x", loading: false })).toBe("error");
  });
});

describe("planResume", () => {
  it("preserva posição e estado de pausa", () => {
    expect(planResume({ currentTime: 12.5, paused: false, ended: false })).toEqual({ time: 12.5, play: true });
    expect(planResume({ currentTime: 12.5, paused: true, ended: false })).toEqual({ time: 12.5, play: false });
  });
  it("terminado ou inválido volta ao início sem tocar", () => {
    expect(planResume({ currentTime: 30, paused: true, ended: true })).toEqual({ time: 0, play: false });
    expect(planResume({ currentTime: Number.NaN, paused: false, ended: false })).toEqual({ time: 0, play: false });
  });
});

describe("renovação da URL assinada", () => {
  function setup(impl: () => Promise<unknown>) {
    const getUrl = vi.fn(impl);
    const onUrl = vi.fn();
    const onGaveUp = vi.fn();
    const r = createUrlRenewer({ getUrl: getUrl as never, onUrl, onGaveUp });
    return { r, getUrl, onUrl, onGaveUp };
  }
  it("renova antes de expirar e para no stop", async () => {
    const s = setup(async () => ok({ url: "u", expiresInSeconds: 300 }));
    s.r.start();
    await flush(0);
    expect(s.onUrl).toHaveBeenCalledTimes(1);
    await flush(269_000);
    expect(s.getUrl).toHaveBeenCalledTimes(1);
    await flush(1500);
    expect(s.getUrl).toHaveBeenCalledTimes(2);
    s.r.stop();
    await flush(600_000);
    expect(s.getUrl).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("retry com backoff e teto quando a renovação falha (resultado ou exceção)", async () => {
    let n = 0;
    const s = setup(async () => {
      n++;
      if (n % 2) throw new Error("rede");
      return fail();
    });
    s.r.start();
    await flush(10 * 60_000);
    expect(s.getUrl).toHaveBeenCalledTimes(MAX_URL_RETRIES + 1);
    expect(s.onGaveUp).toHaveBeenCalledTimes(1);
    expect(s.onUrl).not.toHaveBeenCalled();
  });
  it("recupera após falha transitória", async () => {
    let n = 0;
    const s = setup(async () => (++n < 3 ? fail() : ok({ url: "u", expiresInSeconds: 300 })));
    s.r.start();
    await flush(60_000);
    expect(s.onUrl).toHaveBeenCalledTimes(1);
    expect(s.onGaveUp).not.toHaveBeenCalled();
  });
  it("não insiste quando o vídeo não existe", async () => {
    const s = setup(async () => fail("Criativo não encontrado."));
    s.r.start();
    await flush(10 * 60_000);
    expect(s.getUrl).toHaveBeenCalledTimes(1);
    expect(s.onGaveUp).toHaveBeenCalledTimes(1);
  });
  it("onError do <video> tem teto: não vira loop", async () => {
    const s = setup(async () => ok({ url: "u", expiresInSeconds: 300 }));
    s.r.start();
    await flush(0);
    for (let i = 0; i < MAX_PLAYBACK_ERRORS + 3; i++) {
      s.r.reportPlaybackError();
      await flush(60_000);
    }
    expect(s.getUrl).toHaveBeenCalledTimes(1 + MAX_PLAYBACK_ERRORS);
    expect(s.onGaveUp).toHaveBeenCalledTimes(1);
  });
  it("erro de reprodução durante um fetch em voo descarta a resposta obsoleta (guarda de geração)", async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    const getUrl = vi.fn(() => new Promise((r) => resolvers.push(r)));
    const onUrl = vi.fn();
    const r = createUrlRenewer({ getUrl: getUrl as never, onUrl, onGaveUp: vi.fn() });
    r.start();
    await flush(0);
    r.reportPlaybackError(); // cancela a geração em voo
    resolvers[0](ok({ url: "velha", expiresInSeconds: 300 }));
    await flush(0);
    expect(onUrl).not.toHaveBeenCalled();
    await flush(5000); // o ciclo agendado pelo erro busca de novo
    resolvers[1](ok({ url: "nova", expiresInSeconds: 300 }));
    await flush(0);
    expect(onUrl).toHaveBeenCalledTimes(1);
    expect(onUrl).toHaveBeenCalledWith("nova");
    r.stop();
  });
  it("reportPlaybackOk zera o contador de erros", async () => {
    const s = setup(async () => ok({ url: "u", expiresInSeconds: 300 }));
    s.r.start();
    await flush(0);
    for (let i = 0; i < 10; i++) {
      s.r.reportPlaybackError();
      await flush(60_000);
      s.r.reportPlaybackOk();
    }
    expect(s.onGaveUp).not.toHaveBeenCalled();
  });
});

describe("envio do wizard", () => {
  type F = Record<string, string[]>;
  it("submit que lança não duplica o rascunho no reenvio (mesma instância)", async () => {
    const createDraft = vi.fn(async () => ok({ id: "d1" }));
    const submit = vi.fn<(id: string) => Promise<{ ok: true } | { ok: false; errors: F }>>().mockRejectedValueOnce(new Error("rede")).mockResolvedValueOnce({ ok: true });
    const w = createWizardSubmitter<{ t: string }, F>({ createDraft: createDraft as never, submit });
    expect(await w.run({ t: "a" })).toEqual({ kind: "submit_threw", id: "d1" });
    expect(w.draftId).toBe("d1");
    expect(await w.run({ t: "a" })).toEqual({ kind: "sent", id: "d1" });
    expect(createDraft).toHaveBeenCalledTimes(1);
  });
  it("draft_error libera a trava e o reenvio chama createDraft de novo até obter o rascunho", async () => {
    const createDraft = vi.fn(async () => ok({ id: "d1" }));
    const submit = vi.fn(async () => ({ ok: true as const }));
    const w = createWizardSubmitter<object, F>({ createDraft: createDraft as never, submit });
    // simula falha de draft e sucesso depois: draft_error libera a trava
    createDraft.mockResolvedValueOnce({ ok: false, errors: { title: ["x"] } } as never);
    expect((await w.run({})).kind).toBe("draft_error");
    expect((await w.run({})).kind).toBe("sent");
    expect(createDraft).toHaveBeenCalledTimes(2);
    expect(w.draftId).toBe("d1");
  });
  it("duplo envio simultâneo cria um único rascunho", async () => {
    const createDraft = vi.fn(async () => ok({ id: "d1" }));
    const submit = vi.fn(async () => ({ ok: true as const }));
    const w = createWizardSubmitter<object, F>({ createDraft: createDraft as never, submit });
    const [a, b] = await Promise.all([w.run({}), w.run({})]);
    expect([a.kind, b.kind].sort()).toEqual(["busy", "sent"]);
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it("createDraft que lança libera a trava; falha de cota devolve not_sent com o id", async () => {
    const createDraft = vi.fn().mockRejectedValueOnce(new Error("rede")).mockResolvedValue(ok({ id: "d2" }));
    const submit = vi.fn(async () => ({ ok: false as const, errors: { _form: ["cota"] } as F }));
    const w = createWizardSubmitter<object, F>({ createDraft: createDraft as never, submit });
    expect((await w.run({})).kind).toBe("draft_threw");
    expect(await w.run({})).toEqual({ kind: "not_sent", id: "d2", errors: { _form: ["cota"] } });
  });
});
