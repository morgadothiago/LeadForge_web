import { describe, expect, it } from "vitest";
import {
  actionsFor, estimateDurationSec, filtersToQuery, formatCents, formatDuration, isMockProvider, nextPollDelay, parseLibraryFilters,
  quotaSummary, shouldPoll, stepOfFirstError, urlRefreshDelayMs, voicesFor, progressLabel, WIZARD_STEPS,
} from "./creative-format";
import { buildCreativeFormSchema } from "./creative-form-schema";
import { CREATIVE_STATUSES, type CreativeVoice } from "@/lib/creatives/types";

describe("estados e ações", () => {
  it("habilita as ações do contrato por estado", () => {
    expect(actionsFor("draft")).toMatchObject({ submit: true, cancel: false, retry: false, delete: true, play: false });
    expect(actionsFor("queued")).toMatchObject({ submit: false, cancel: true, retry: false });
    expect(actionsFor("processing")).toMatchObject({ cancel: true, retry: false });
    expect(actionsFor("ready")).toMatchObject({ play: true, cancel: false, retry: false, delete: true });
    expect(actionsFor("failed")).toMatchObject({ retry: true, cancel: false });
    expect(actionsFor("canceled")).toMatchObject({ retry: true, cancel: false });
  });
  it("polling só enquanto ativo (para em todos os terminais)", () => {
    for (const s of CREATIVE_STATUSES) expect(shouldPoll(s)).toBe(s === "queued" || s === "processing");
  });
  it("backoff do polling cresce e tem teto", () => {
    expect(nextPollDelay(0)).toBe(6000);
    expect(nextPollDelay(1)).toBe(12000);
    expect(nextPollDelay(9)).toBe(20000);
  });
  it("renova a URL assinada antes de expirar", () => {
    expect(urlRefreshDelayMs(300)).toBe(270_000);
    expect(urlRefreshDelayMs(10)).toBe(5000);
  });
  it("rótulo de progresso", () => {
    expect(progressLabel({ status: "queued", job: null })).toMatch(/fila/);
    expect(progressLabel({ status: "processing", job: { progressPct: 42.4 } as never })).toContain("42%");
    expect(progressLabel({ status: "processing", job: null })).toBe("Gerando o vídeo…");
    expect(progressLabel({ status: "ready", job: null })).toBe("");
  });
});

describe("estimativas e formatação", () => {
  it("estima ~2,5 palavras/s", () => {
    expect(estimateDurationSec("")).toBe(0);
    expect(estimateDurationSec("um dois três quatro cinco")).toBe(2);
    expect(estimateDurationSec(Array(50).fill("a").join(" "))).toBe(20);
  });
  it("formata duração e custo (mock = R$ 0,00)", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(125)).toBe("2 min 05 s");
    expect(formatCents(0).replace(/\s/g, " ")).toBe("R$ 0,00");
  });
  it("detecta o provedor mock", () => {
    expect(isMockProvider("mock")).toBe(true);
    expect(isMockProvider("heygen")).toBe(false);
    expect(isMockProvider(undefined)).toBe(false);
  });
  it("filtra vozes por idioma", () => {
    const v: CreativeVoice[] = [{ id: "a", name: "A", language: "pt-BR" }, { id: "b", name: "B", language: "en" }];
    expect(voicesFor(v, "en").map((x) => x.id)).toEqual(["b"]);
  });
});

describe("cota", () => {
  const base = { limits: { maxDurationSec: 120, maxScriptChars: 3000, maxConcurrentJobsPerOrg: 2, maxPerMonthPerOrg: 20 } };
  it("livre", () => expect(quotaSummary({ ...base, usage: { usedThisMonth: 3, activeNow: 1 } })).toEqual({ monthRemaining: 17, concurrentRemaining: 1, blockedReason: null }));
  it("mensal esgotada", () => expect(quotaSummary({ ...base, usage: { usedThisMonth: 20, activeNow: 0 } }).blockedReason).toMatch(/cota mensal/));
  it("simultâneos esgotados", () => expect(quotaSummary({ ...base, usage: { usedThisMonth: 1, activeNow: 2 } }).blockedReason).toMatch(/ao mesmo tempo/));
});

describe("filtros da biblioteca (URL)", () => {
  it("aceita status válido e q; ignora lixo", () => {
    expect(parseLibraryFilters({ status: "ready", q: "  oi " })).toEqual({ status: "ready", q: "oi" });
    expect(parseLibraryFilters({ status: "hack", q: "  " })).toEqual({});
    expect(parseLibraryFilters({ status: ["failed", "x"] })).toEqual({ status: "failed" });
  });
  it("serializa", () => {
    expect(filtersToQuery({})).toBe("");
    expect(filtersToQuery({ status: "ready", q: "a b" })).toBe("?status=ready&q=a+b");
  });
});

describe("passos do formulário", () => {
  it("mapeia erro do servidor para o passo do 1o campo", () => {
    expect(stepOfFirstError({ voiceRef: ["x"], title: ["y"] })).toBe(0);
    expect(stepOfFirstError({ voiceRef: ["x"] })).toBe(2);
    expect(stepOfFirstError({ _form: ["x"] })).toBe(-1);
    expect(WIZARD_STEPS.map((s) => s.key)).toEqual(["script", "avatar", "voice", "format", "review"]);
  });
  it("schema: obrigatórios em PT-BR e teto de caracteres da config", () => {
    const schema = buildCreativeFormSchema({ maxScriptChars: 10 });
    const bad = schema.safeParse({ title: "", script: "", language: "pt-BR", avatarRef: "", voiceRef: "", aspectRatio: "9:16" });
    expect(bad.success).toBe(false);
    const msgs = bad.success ? [] : bad.error.issues.map((i) => i.message);
    expect(msgs).toEqual(expect.arrayContaining(["Título é obrigatório.", "Roteiro é obrigatório.", "Escolha um avatar.", "Escolha uma voz."]));
    const long = schema.safeParse({ title: "t", script: "x".repeat(11), language: "en", avatarRef: "a", voiceRef: "v", aspectRatio: "1:1" });
    expect(long.success ? "" : long.error.issues[0].message).toMatch(/máx\. 10/);
    expect(schema.safeParse({ title: "t", script: "ok", language: "en", avatarRef: "a", voiceRef: "v", aspectRatio: "1:1" }).success).toBe(true);
  });
});
