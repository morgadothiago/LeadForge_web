import { afterEach, describe, expect, it, vi } from "vitest";
import { matchesMagic } from "@/lib/storage/magic";
import { getCreativeConfig } from "./config";
import { getAvatarVideoProvider, _resetCreativeProviderForTests } from "./factory";
import { moderateScript, estimateDurationSec } from "./moderation";
import { MockAvatarVideoProvider, MOCK_AVATARS, MOCK_VOICES } from "./providers/mock";
import { backoffMs } from "./runner";

const input = (over: Partial<Parameters<MockAvatarVideoProvider["createVideo"]>[0]> = {}) => ({
  script: "Olá, tudo bem?", avatarId: "mock-ana", voiceId: "mock-voz-br-f", language: "pt-BR" as const, aspectRatio: "9:16" as const, durationSec: 10, idempotencyKey: "creative:c1:run:1", ...over,
});
async function collect(it: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of it) parts.push(Buffer.from(c));
  return Buffer.concat(parts);
}

afterEach(() => {
  vi.restoreAllMocks();
  _resetCreativeProviderForTests();
});

describe("provider mock", () => {
  it("catalogo fixo de avatares e vozes (D-051-3), pt-BR e en", async () => {
    const p = new MockAvatarVideoProvider({ delayMs: 0 });
    expect(await p.listAvatars()).toEqual(MOCK_AVATARS);
    const voices = await p.listVoices();
    expect(voices).toEqual(MOCK_VOICES);
    expect(new Set(voices.map((v) => v.language))).toEqual(new Set(["pt-BR", "en"]));
    expect(p.estimateCostCents()).toBe(0);
  });

  it("idempotente por chave: mesma chave => mesmo id; chave nova => id novo", async () => {
    const p = new MockAvatarVideoProvider({ delayMs: 0 });
    const a = await p.createVideo(input());
    const b = await p.createVideo(input());
    const c = await p.createVideo(input({ idempotencyKey: "creative:c1:run:2" }));
    expect(a.providerJobId).toBe(b.providerJobId);
    expect(c.providerJobId).not.toBe(a.providerJobId);
  });

  it("progresso por relogio injetado: processing -> done apos o delay", async () => {
    let t = 1_000;
    const p = new MockAvatarVideoProvider({ delayMs: 1000, now: () => t });
    const { providerJobId } = await p.createVideo(input());
    expect(await p.getStatus(providerJobId)).toMatchObject({ state: "processing" });
    t += 500;
    const mid = await p.getStatus(providerJobId);
    expect(mid).toMatchObject({ state: "processing", progressPct: 50 });
    t += 600;
    expect(await p.getStatus(providerJobId)).toMatchObject({ state: "done" });
  });

  it("video placeholder deterministico, mp4 valido pela checagem de magic bytes da SPEC-050, em stream", async () => {
    const p = new MockAvatarVideoProvider({ delayMs: 0 });
    const { providerJobId } = await p.createVideo(input());
    const v1 = await p.fetchVideo(providerJobId);
    const v2 = await p.fetchVideo(providerJobId);
    const b1 = await collect(v1.body);
    expect(v1.contentType).toBe("video/mp4");
    expect(b1.equals(await collect(v2.body))).toBe(true);
    expect(matchesMagic("video/mp4", b1.subarray(0, 16))).toBe(true);
    expect(b1.length).toBeGreaterThan(1000);
  });

  it("diretivas de teste: fail / hang / reject / unavailable; avatar/voz fora do catalogo e recusado", async () => {
    const p = new MockAvatarVideoProvider({ delayMs: 0 });
    expect(await p.getStatus((await p.createVideo(input({ script: "x [[mock:fail]]" }))).providerJobId)).toMatchObject({ state: "failed" });
    expect(await p.getStatus((await p.createVideo(input({ script: "x [[mock:hang]]" }))).providerJobId)).toMatchObject({ state: "processing" });
    await expect(p.createVideo(input({ script: "[[mock:reject]]" }))).rejects.toMatchObject({ retryable: false });
    await expect(p.createVideo(input({ script: "[[mock:unavailable]]" }))).rejects.toMatchObject({ retryable: true });
    await expect(p.createVideo(input({ avatarId: "inexistente" }))).rejects.toMatchObject({ retryable: false });
  });

  it("cancel marca o job como failed(canceled) no provedor", async () => {
    const p = new MockAvatarVideoProvider({ delayMs: 10_000 });
    const { providerJobId } = await p.createVideo(input());
    await p.cancel(providerJobId);
    expect(await p.getStatus(providerJobId)).toMatchObject({ state: "failed", rawStatus: "canceled" });
  });

  it("nunca usa rede: fetch global nao e chamado em nenhuma operacao", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const p = getAvatarVideoProvider({ NODE_ENV: "test" });
    const { providerJobId } = await p.createVideo(input());
    await p.getStatus(providerJobId);
    await collect((await p.fetchVideo(providerJobId)).body);
    expect(p.name).toBe("mock");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("config", () => {
  it("defaults (Q-051-6/9): 2 simultaneos, 20/mes, 120s", () => {
    const c = getCreativeConfig({ NODE_ENV: "test" });
    expect(c).toMatchObject({ provider: "mock", maxConcurrentJobsPerOrg: 2, maxPerMonthPerOrg: 20, maxDurationSec: 120, blocklist: [] });
  });
  it("le limites/blocklist de env; valor invalido cai no default", () => {
    const c = getCreativeConfig({ CREATIVE_MAX_CONCURRENT_JOBS_PER_ORG: "5", CREATIVE_MAX_PER_MONTH_PER_ORG: "abc", CREATIVE_SCRIPT_BLOCKLIST: " golpe , Pirâmide ,," });
    expect(c.maxConcurrentJobsPerOrg).toBe(5);
    expect(c.maxPerMonthPerOrg).toBe(20);
    expect(c.blocklist).toEqual(["golpe", "Pirâmide"]);
  });
  it("provedor desconhecido => erro tipado config; producao sem opt-in explicito => config", () => {
    expect(() => getCreativeConfig({ CREATIVE_PROVIDER: "heygen" })).toThrowError(expect.objectContaining({ code: "config" }));
    expect(() => getCreativeConfig({ NODE_ENV: "production" })).toThrowError(expect.objectContaining({ code: "config" }));
    expect(getCreativeConfig({ NODE_ENV: "production", CREATIVE_PROVIDER: "mock" }).provider).toBe("mock");
  });
});

describe("moderacao minima (D-051-7) e estimativa", () => {
  const cfg = { maxScriptChars: 50, blocklist: ["golpe", "pirâmide"] };
  it("limite de tamanho", () => {
    expect(moderateScript("a".repeat(51), cfg)).toMatch(/limite de 50/);
    expect(moderateScript("ok", cfg)).toBeNull();
  });
  it("blocklist sem acento/caixa", () => {
    expect(moderateScript("Isso é um GOLPE", cfg)).toMatch(/não permitidos/);
    expect(moderateScript("esquema de PIRAMIDE", cfg)).toMatch(/não permitidos/);
  });
  it("estimativa de duracao ~2,5 palavras/s", () => {
    expect(estimateDurationSec(Array(25).fill("palavra").join(" "))).toBe(10);
    expect(estimateDurationSec("oi")).toBe(1);
  });
});

describe("backoff", () => {
  it("exponencial com teto de 60s e jitter +-20%", () => {
    expect(backoffMs(0, () => 0.5)).toBe(5000);
    expect(backoffMs(1, () => 0.5)).toBe(10_000);
    expect(backoffMs(20, () => 0.5)).toBe(60_000);
    expect(backoffMs(2, () => 0)).toBe(16_000);
    expect(backoffMs(2, () => 1)).toBe(24_000);
  });
});
