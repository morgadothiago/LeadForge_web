import "dotenv/config";
import { randomBytes } from "node:crypto";
import { AxiosError, type AxiosAdapter } from "axios";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { prisma } from "@/lib/prisma";
import { seed, SEED_IDS } from "../../../prisma/seed";
import { encrypt } from "@/lib/crypto/secret-box";
import { _setCacheTtl, invalidateIntegrationCache } from "@/lib/integrations/config";
import { _setIntegrationResolver, resolvesToPrivateOnly } from "@/lib/integrations/url-guard";
import { ClaudeProvider, createOpenAICompatClient, describeLlmProvider, getLlmProvider, isPrivateLlmHost, OpenAICompatProvider } from "./provider";
import { budgetState, costMicros } from "./budget";

const OUT = '{"action":"send","message":"Olá, tudo bem?","confidence":0.9,"reasonSummary":"ok"}';
const okBody = { choices: [{ message: { content: OUT } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
const SECRET = "gsk-SEGREDO-1234567890";
const req = { model: "llama3.1", system: "s", user: "u" };

function adapter(steps: { status: number; headers?: Record<string, string>; data?: unknown; timeout?: boolean }[]) {
  let i = 0;
  const calls: { headers?: Record<string, unknown>; url?: string; data?: string }[] = [];
  const fn: AxiosAdapter = async (config) => {
    calls.push({ headers: config.headers as never, url: config.url, data: config.data as string });
    const s = steps[Math.min(i++, steps.length - 1)]!;
    const res = { data: s.data ?? {}, status: s.status, statusText: "", headers: s.headers ?? {}, config, request: {} };
    if (s.timeout) throw new AxiosError(`timeout ${SECRET}`, "ECONNABORTED", config);
    if (s.status < 300) return res;
    throw new AxiosError(`falhou ${SECRET}`, "ERR_BAD_RESPONSE", config, {}, res);
  };
  return { fn, calls };
}
const run = (a: ReturnType<typeof adapter>, key?: string) =>
  new OpenAICompatProvider(createOpenAICompatClient("http://localhost:11434/v1/", key, a.fn)).generate(req).then(() => null, (e) => e as Error & { code?: string });


describe("OpenAICompatProvider", () => {
  it("sucesso: POST /chat/completions, system+user, tokens do usage", async () => {
    const a = adapter([{ status: 200, data: okBody }]);
    const r = await new OpenAICompatProvider(createOpenAICompatClient("http://localhost:11434/v1/", undefined, a.fn)).generate(req);
    expect(r.output.action).toBe("send");
    expect([r.tokensIn, r.tokensOut]).toEqual([10, 5]);
    expect(a.calls[0]!.url).toBe("/chat/completions");
    const body = JSON.parse(a.calls[0]!.data!);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
    expect(body.model).toBe("llama3.1");
  });
  it("Authorization só com chave (Ollama sem chave não envia)", async () => {
    const a = adapter([{ status: 200, data: okBody }]);
    await new OpenAICompatProvider(createOpenAICompatClient("http://x.test/v1", undefined, a.fn)).generate(req);
    expect(JSON.stringify(a.calls[0]!.headers)).not.toMatch(/authorization/i);
    const b = adapter([{ status: 200, data: okBody }]);
    await new OpenAICompatProvider(createOpenAICompatClient("http://x.test/v1", SECRET, b.fn)).generate(req);
    expect(String((b.calls[0]!.headers as { toJSON?: () => Record<string, unknown> }).toJSON?.().authorization ?? (b.calls[0]!.headers as Record<string, unknown>).authorization)).toBe(`Bearer ${SECRET}`);
  });
  it("usage ausente/parcial => tokens 0; content com texto ao redor é tolerado", async () => {
    const a = adapter([{ status: 200, data: { choices: [{ message: { content: `Segue:\n${OUT}` } }] } }]);
    const r = await new OpenAICompatProvider(createOpenAICompatClient("http://x.test/v1", undefined, a.fn)).generate(req);
    expect([r.tokensIn, r.tokensOut]).toEqual([0, 0]);
    const b = adapter([{ status: 200, data: { choices: [{ message: { content: OUT } }], usage: { prompt_tokens: 7 } } }]);
    const r2 = await new OpenAICompatProvider(createOpenAICompatClient("http://x.test/v1", undefined, b.fn)).generate(req);
    expect([r2.tokensIn, r2.tokensOut]).toEqual([7, 0]);
  });
  it("saída fora do schema / não-JSON => validation; corpo fora do formato => upstream", async () => {
    const bad = await run(adapter([{ status: 200, data: { choices: [{ message: { content: "oi, sem json" } }] } }]));
    expect(bad!.code).toBe("validation");
    const schema = await run(adapter([{ status: 200, data: { choices: [{ message: { content: '{"action":"send","confidence":2}' } }] } }]));
    expect(schema!.code).toBe("validation");
    const shape = await run(adapter([{ status: 200, data: { foo: 1 } }]));
    expect(shape!.code).toBe("upstream");
    const html = await run(adapter([{ status: 200, data: "<html>" }]));
    expect(html!.code).toBe("upstream");
  });
  it("400/401/404: erro PT-BR, sem retry, sem vazar chave", async () => {
    for (const status of [400, 401, 404]) {
      const a = adapter([{ status }]);
      const err = await run(a, SECRET);
      expect(err).not.toBeNull();
      expect(a.calls.length).toBe(1);
      expect(JSON.stringify(err) + err!.message).not.toContain(SECRET);
      expect(err!.message).toMatch(/[a-zà-ú]/i);
    }
  });
  it("429 com Retry-After: retry limitado, esgota em rate_limited sem vazar chave", async () => {
    const a = adapter([{ status: 429, headers: { "retry-after": "0" } }]);
    const err = await run(a, SECRET);
    expect(err!.code).toBe("rate_limited");
    expect(a.calls.length).toBe(3);
    expect(JSON.stringify(err) + err!.message).not.toContain(SECRET);
  }, 20_000);
  it("429 sem Retry-After e 5xx: retry limitado (máx. 3)", async () => {
    const a = adapter([{ status: 429 }, { status: 200, data: okBody }]);
    const r = await new OpenAICompatProvider(createOpenAICompatClient("http://x.test/v1", undefined, a.fn)).generate(req);
    expect(r.tokensIn).toBe(10);
    const b = adapter([{ status: 503 }]);
    const err = await run(b);
    expect(err).not.toBeNull();
    expect(b.calls.length).toBe(3);
  }, 30_000);
  it("timeout: erro PT-BR retryable limitado, sem vazar chave", async () => {
    const a = adapter([{ status: 0, timeout: true }]);
    const err = await run(a, SECRET);
    expect(err!.code).toBe("timeout");
    expect(a.calls.length).toBe(3);
    expect(JSON.stringify(err) + err!.message).not.toContain(SECRET);
  }, 30_000);
});

describe("custo/orçamento (D-36-3)", () => {
  it("free/local => 0; claude e desconhecido mantêm preço; host privado => 0", () => {
    for (const m of ["llama3.1:8b", "qwen2.5", "mistral", "gemma2:9b", "gemini-2.0-flash", "gemini-1.5-flash-8b", "meta-llama/llama-3.3-70b"]) expect(costMicros(m, 1000, 1000)).toBe(0);
    expect(costMicros("claude-haiku-4-5", 1000, 100)).toBe(1500);
    expect(costMicros("modelo-x", 1000, 100)).toBe(7500);
    expect(costMicros("gemini-pro-caro", 1000, 100)).toBe(7500);
    expect(costMicros("modelo-x", 1000, 100, { freeHost: true })).toBe(0);
  });
  it("só modelos da lista são free; phi/deepseek e prefixo qualquer não zeram", () => {
    for (const m of ["phi3", "deepseek-r1", "acme/llama-3", "openai/gpt-4o", "gpt-4o"]) expect(costMicros(m, 1000, 100)).toBe(7500);
  });
  it("hard stop em 100% continua valendo com gasto zero + gasto acumulado", () => {
    expect(budgetState(0, 100)).toBe("ok");
    expect(budgetState(100 * 10_000, 100)).toBe("exhausted");
  });
});

describe("seleção por org (getLlmProvider)", () => {
  const OTHER = "00000000-0000-4000-8000-0000000000e1";
  beforeAll(async () => {
    await seed(prisma);
    await prisma.organization.upsert({ where: { id: OTHER }, update: {}, create: { id: OTHER, name: "Outra 036", slug: "zz-036-other", status: "active" } });
    await prisma.integrationSecret.deleteMany({ where: { orgId: { in: [SEED_IDS.org, OTHER] }, integration: "llm" } });
  });
  afterEach(async () => {
    await prisma.integrationSecret.deleteMany({ where: { orgId: { in: [SEED_IDS.org, OTHER] }, integration: "llm" } });
    invalidateIntegrationCache();
    _setIntegrationResolver(null);
    _setCacheTtl(null);
  });
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: OTHER } });
  });
  const put = (orgId: string, v: string, baseUrl: string | null, allowPrivateHost = false) =>
    prisma.integrationSecret.create({ data: { orgId, integration: "llm", name: "default", encryptedValue: encrypt(v), hint: "", baseUrl, allowPrivateHost, managedByPlatform: true } });

  it("isPrivateLlmHost: só vale se o host resolve para IP privado (URL pública + checkbox => false)", async () => {
    _setIntegrationResolver(async (h) => (h === "interno.test" ? ["10.0.0.5"] : h === "misto.test" ? ["10.0.0.5", "8.8.8.8"] : ["8.8.8.8"]));
    await put(SEED_IDS.org, "", "https://publico.test/v1", true);
    expect(await isPrivateLlmHost(SEED_IDS.org)).toBe(false);
    await prisma.integrationSecret.deleteMany({ where: { orgId: SEED_IDS.org, integration: "llm" } });
    invalidateIntegrationCache();
    await put(SEED_IDS.org, "", "https://interno.test/v1", true);
    expect(await isPrivateLlmHost(SEED_IDS.org)).toBe(true);
    await prisma.integrationSecret.deleteMany({ where: { orgId: SEED_IDS.org, integration: "llm" } });
    invalidateIntegrationCache();
    await put(SEED_IDS.org, "", "https://misto.test/v1", true);
    expect(await isPrivateLlmHost(SEED_IDS.org)).toBe(false);
    expect(await resolvesToPrivateOnly("localhost")).toBe(true);
    expect(await resolvesToPrivateOnly("169.254.169.254")).toBe(false);
  });

  it("sem baseUrl => ClaudeProvider (regressão); com baseUrl => compat; por org", async () => {
    await put(SEED_IDS.org, "sk-ant-aaaaaaaaaaaa", null);
    await put(OTHER, "", "http://localhost:11434/v1", true);
    expect(await getLlmProvider(SEED_IDS.org)).toBeInstanceOf(ClaudeProvider);
    expect(await getLlmProvider(OTHER)).toBeInstanceOf(OpenAICompatProvider);
    expect(await describeLlmProvider(SEED_IDS.org, "claude-haiku-4-5")).toEqual({ kind: "claude", host: null, model: "claude-haiku-4-5" });
    const info = await describeLlmProvider(OTHER, "llama3.1");
    expect(info.kind).toBe("openai_compat");
    expect(JSON.stringify(info)).not.toContain("11434");
  });
  it("ao conectar o url-guard revalida: privado sem allowPrivateHost e metadados falham", async () => {
    await put(SEED_IDS.org, "", "http://localhost:11434/v1", false);
    await expect(getLlmProvider(SEED_IDS.org)).rejects.toMatchObject({ code: "config" });
    await prisma.integrationSecret.deleteMany({ where: { orgId: SEED_IDS.org, integration: "llm" } });
    invalidateIntegrationCache();
    await put(SEED_IDS.org, "", "http://169.254.169.254/v1", true);
    await expect(getLlmProvider(SEED_IDS.org)).rejects.toMatchObject({ code: "config" });
  });
  it("sem config => AppError config", async () => {
    await expect(getLlmProvider(SEED_IDS.org)).rejects.toMatchObject({ code: "config" });
  });
});
