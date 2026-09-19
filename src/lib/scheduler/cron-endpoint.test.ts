import { BUDGET_MARGIN_MS, MAX_EFFECTIVE_BUDGET_MS, ROUTE_MAX_DURATION_S, SEND_WORST_CASE_MS } from "./config";
import { TIMEOUTS } from "@/lib/channels/email";
import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetCronRateLimit, bearerToken, handleCronTick, secretsMatch } from "./cron-endpoint";
import { getCronSecret, getSchedulerConfig } from "./config";
import type { TickSummary } from "./run-tick";
import * as route from "@/app/api/cron/tick/route";
import { prisma } from "@/lib/prisma";

const SECRET = "s".repeat(20) + "SEGREDO-de-teste-1234567890";
const ok: TickSummary = { status: "ok", runId: "r1", durationMs: 5, budget: null, counters: { result_sent: 2 } };
const call = (method: string, auth?: string) => new Request("http://localhost:3000/api/cron/tick", { method, headers: auth ? { authorization: auth } : {} });
const snap = async (r: Response) => ({ status: r.status, body: await r.text(), headers: [...r.headers.entries()].sort() });
const run = vi.fn(async () => ok);

beforeEach(() => { _resetCronRateLimit(); run.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); delete process.env.CRON_SECRET; });
afterAll(() => prisma.$disconnect());

describe("config", () => {
  it("CRON_SECRET ausente/curto = null; 32+ ok; limites com defaults e valores inválidos ignorados", () => {
    expect(getCronSecret({})).toBeNull();
    expect(getCronSecret({ CRON_SECRET: "x".repeat(31) })).toBeNull();
    expect(getCronSecret({ CRON_SECRET: "x".repeat(32) })).toBe("x".repeat(32));
    expect(getSchedulerConfig({})).toEqual({ timeBudgetMs: 25_000, maxSends: 20 });
    expect(getSchedulerConfig({ SCHEDULER_TIME_BUDGET_MS: "1000", SCHEDULER_MAX_SENDS: "3" })).toEqual({ timeBudgetMs: 1000, maxSends: 3 });
    expect(getSchedulerConfig({ SCHEDULER_TIME_BUDGET_MS: "abc", SCHEDULER_MAX_SENDS: "-1" })).toEqual({ timeBudgetMs: 25_000, maxSends: 20 });
  });
  it("comparação em tempo constante (hash) e parse do Bearer", () => {
    expect(secretsMatch("a", "a")).toBe(true);
    expect(secretsMatch("a", "b")).toBe(false);
    expect(secretsMatch("", SECRET)).toBe(false);
    expect(bearerToken(call("POST", `Bearer ${SECRET}`))).toBe(SECRET);
    expect(bearerToken(call("POST", "Basic xxx"))).toBeNull();
    expect(bearerToken(call("POST"))).toBeNull();
  });
});

describe("endpoint", () => {
  it("503 quando CRON_SECRET ausente ou curto (nunca aberto), mesmo com Authorization", async () => {
    for (const secret of [null, "curto"]) {
      const r = await handleCronTick(call("POST", "Bearer curto"), { secret: secret === "curto" ? getCronSecret({ CRON_SECRET: "curto" }) : secret, run });
      expect(r.status).toBe(503);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("401 idêntico (status, corpo e headers) sem header, malformado e errado; não executa", async () => {
    const a = await snap(await handleCronTick(call("POST"), { secret: SECRET, run }));
    const b = await snap(await handleCronTick(call("POST", "Bearer errado"), { secret: SECRET, run }));
    const c = await snap(await handleCronTick(call("POST", SECRET), { secret: SECRET, run }));
    const d = await snap(await handleCronTick(call("GET", `Bearer ${SECRET}x`), { secret: SECRET, run }));
    expect(a.status).toBe(401);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(d).toEqual(a);
    expect(a.body).not.toContain(SECRET);
    expect(run).not.toHaveBeenCalled();
  });

  it("200 com resumo em POST e GET (Vercel Cron)", async () => {
    for (const m of ["POST", "GET"]) {
      const r = await handleCronTick(call(m, `Bearer ${SECRET}`), { secret: SECRET, run });
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(await r.json()).toMatchObject({ status: "ok", counters: { result_sent: 2 } });
    }
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("rate limit só de tentativas inválidas: 429 após o teto; credencial válida continua atendida", async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await handleCronTick(call("POST", `Bearer forjado-${i}`), { secret: SECRET, run })).status;
    expect(last).toBe(429);
    const blocked = await handleCronTick(call("POST", "Bearer outro"), { secret: SECRET, run });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect((await handleCronTick(call("POST", `Bearer ${SECRET}`), { secret: SECRET, run })).status).toBe(200);
  });

  it("rodada que lança -> 500 genérico sem vazar erro", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await handleCronTick(call("POST", `Bearer ${SECRET}`), { secret: SECRET, run: async () => { throw new Error(`falha com ${SECRET}`); } });
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain(SECRET);
  });
});

describe("Route Handler", () => {
  it("exports: dynamic force-dynamic; maxDuration = constante e >= orçamento efetivo + pior caso de um envio + margem", () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(ROUTE_MAX_DURATION_S);
    const cfg = getSchedulerConfig({});
    expect(cfg.timeBudgetMs).toBe(25_000);
    expect(route.maxDuration * 1000).toBeGreaterThanOrEqual(cfg.timeBudgetMs + SEND_WORST_CASE_MS + BUDGET_MARGIN_MS);
    // mesmo com env alta, o orçamento é limitado (nunca deixa maxDuration < efetivo + pior caso)
    const huge = getSchedulerConfig({ SCHEDULER_TIME_BUDGET_MS: "500000" });
    expect(huge.timeBudgetMs).toBe(MAX_EFFECTIVE_BUDGET_MS);
    expect(route.maxDuration * 1000).toBeGreaterThanOrEqual(huge.timeBudgetMs + SEND_WORST_CASE_MS);
  });
  it("pior caso do SMTP cabe em SEND_WORST_CASE_MS (conexão + greeting + socket)", () => {
    expect(TIMEOUTS.connectionTimeout + TIMEOUTS.greetingTimeout + TIMEOUTS.socketTimeout).toBeLessThanOrEqual(SEND_WORST_CASE_MS + 1000);
  });
  it("405 nos demais métodos (HEAD/OPTIONS/PUT/PATCH/DELETE) com Allow", async () => {
    for (const h of [route.HEAD, route.OPTIONS, route.PUT, route.PATCH, route.DELETE]) {
      const r = await h();
      expect(r.status).toBe(405);
      expect(r.headers.get("allow")).toBe("GET, POST");
    }
  });
  it("POST/GET via rota: 503 sem CRON_SECRET, 401 errado, (200 coberto com rodada injetada acima; a rodada real nunca roda em teste sem `campaignIds`)", async () => {
    delete process.env.CRON_SECRET;
    expect((await route.POST(call("POST", `Bearer ${SECRET}`))).status).toBe(503);
    process.env.CRON_SECRET = SECRET;
    expect((await route.GET(call("GET", "Bearer errado"))).status).toBe(401);
    expect((await route.POST(call("POST"))).status).toBe(401);
  });
  it("Authorization/segredo nunca aparecem em log (console capturado)", async () => {
    process.env.CRON_SECRET = SECRET;
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    // NUNCA executar a rodada real aqui (mexeria em leads do banco de dev): rodada sempre injetada.
    await route.POST(call("POST", "Bearer forjado"));
    await handleCronTick(call("POST", `Bearer ${SECRET}`), { secret: SECRET, run });
    await handleCronTick(call("POST", `Bearer ${SECRET}`), { secret: SECRET, run: async () => { throw new Error("x"); } });
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("Bearer");
  });
});
