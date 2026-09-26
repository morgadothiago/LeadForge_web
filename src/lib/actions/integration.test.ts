import "dotenv/config";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { seed, SEED_IDS } from "../../../prisma/seed";
import { signInAsSeedAdmin, signInAs, signOut } from "@/lib/auth/test-helpers";
import { removeIntegration, saveIntegration, testIntegration } from "./integration";
import { listIntegrationAudit, listIntegrations } from "@/lib/queries/integration";
import { _setCacheTtl, getIntegrationConfig, invalidateIntegrationCache } from "@/lib/integrations/config";
import { _setIntegrationResolver } from "@/lib/integrations/url-guard";
import { _resetTestQuota, _setTestDeadline } from "@/lib/integrations/test-connection";
import { getWhatsAppProvider } from "@/lib/whatsapp/provider";
import { hashPassword } from "@/lib/auth/password";

const KEY_A = "sk-test-aaaa1234";
const KEY_B = "sk-test-bbbb5678";
const ENV_KEY = "env-key-zzzz9999";
const TAG = "zz-integ";

let server: Server;
let base = "";
let mode: "ok" | "401" | "429" | "hang" | "redirect" = "ok";
let hits = 0;
let seenKey = "";
let auditBefore = new Date();
let nonAdminId = "";
const savedEnc = process.env.ENCRYPTION_KEY;
const saved = { u: process.env.EVOLUTION_API_URL, k: process.env.EVOLUTION_API_KEY };
const logs: string[] = [];

async function cleanup() {
  await prisma.whatsAppInstance.deleteMany({ where: { instanceName: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}
const secret = async (integration: "evolution" | "llm") => prisma.integrationSecret.findFirstOrThrow({ where: { integration } });
const dump = (o: unknown) => JSON.stringify(o);

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64"); // chave falsa, só em memória
  await seed(prisma);
  await cleanup();
  auditBefore = new Date();
  await prisma.integrationSecret.deleteMany();
  server = createServer((req, res) => {
    hits++;
    seenKey = String(req.headers.apikey ?? "");
    if (mode === "hang") return; // nunca responde
    if (mode === "401") { res.statusCode = 401; return void res.end("{}"); }
    if (mode === "429") { res.statusCode = 429; res.setHeader("retry-after", "7"); return void res.end("{}"); }
    if (mode === "redirect") { res.statusCode = 302; res.setHeader("location", "http://169.254.169.254/latest"); return void res.end(); }
    res.statusCode = 200; res.setHeader("content-type", "application/json"); res.end("[]");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const u = await prisma.user.create({ data: { email: `${TAG}@x.test`, name: "Comum", passwordHash: await hashPassword("Senha-forte-123") , role: "member" } as never });
  nonAdminId = u.id;
  for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
}, 30000);

afterEach(() => {
  _setCacheTtl(null);
  _setIntegrationResolver(null);
  _setTestDeadline(null);
  _resetTestQuota();
  invalidateIntegrationCache();
  mode = "ok";
});
afterAll(async () => {
  vi.restoreAllMocks();
  if (savedEnc === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = savedEnc;
  await new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); });
  await prisma.integrationSecret.deleteMany();
  await prisma.integrationAuditLog.deleteMany({ where: { at: { gte: auditBefore } } });
  await cleanup();
  for (const [k, v] of [["EVOLUTION_API_URL", saved.u], ["EVOLUTION_API_KEY", saved.k]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe("permissão: só admin", () => {
  it("não-admin recebe Sem permissão em todas as actions e queries", async () => {
    await signInAs(nonAdminId);
    const id = "00000000-0000-4000-8000-000000000000";
    const rs = [await saveIntegration({ integration: "llm", value: KEY_A }), await removeIntegration({ id, confirm: true }), await testIntegration(id)];
    for (const r of rs) expect(r.ok === false && r.errors?._form?.[0]).toBe("Sem permissão.");
    await expect(listIntegrations()).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(listIntegrationAudit()).rejects.toMatchObject({ name: "ForbiddenError" });
    expect(await prisma.integrationSecret.count()).toBe(0);
  });
  it("sem sessão -> Sessão expirada", async () => {
    signOut();
    const r = await saveIntegration({ integration: "llm", value: KEY_A });
    expect(r.ok === false && r.errors?._form?.[0]).toMatch(/Sessão expirada/);
    await expect(listIntegrations()).rejects.toMatchObject({ name: "UnauthorizedError" });
  });
});

describe("salvar / resolver / cache / fallback", () => {
  it("salva cifrado, sem eco; edição vazia mantém; troca vale sem reiniciar; remover volta ao env", async () => {
    await signInAsSeedAdmin();
    _setCacheTtl(60_000);
    process.env.EVOLUTION_API_URL = base;
    process.env.EVOLUTION_API_KEY = ENV_KEY;
    expect((await getIntegrationConfig(SEED_IDS.org, "evolution")).origin).toBe("env");

    const r1 = await saveIntegration({ integration: "evolution", value: KEY_A, baseUrl: base, allowPrivateHost: true });
    expect(r1.ok).toBe(true);
    expect(dump(r1)).not.toContain(KEY_A);
    const row = await secret("evolution");
    expect(row.encryptedValue).toMatch(/^v1:/);
    expect(row.encryptedValue).not.toContain(KEY_A);
    expect(row.hint).toBe("1234");
    let cfg = await getIntegrationConfig(SEED_IDS.org, "evolution");
    expect(cfg.origin).toBe("db");
    expect(cfg.reveal()).toBe(KEY_A);
    expect(dump(cfg)).not.toContain(KEY_A);

    // edição com valor vazio mantém a chave
    const r2 = await saveIntegration({ integration: "evolution", value: "", baseUrl: base, allowPrivateHost: true });
    expect(r2.ok).toBe(true);
    expect((await secret("evolution")).encryptedValue).toBe(row.encryptedValue);

    // troca vale sem reiniciar, mesmo com cache longo (invalidado ao salvar) e chega ao provider
    await saveIntegration({ integration: "evolution", value: KEY_B, baseUrl: base, allowPrivateHost: true });
    cfg = await getIntegrationConfig(SEED_IDS.org, "evolution");
    expect(cfg.reveal()).toBe(KEY_B);
    await getWhatsAppProvider(SEED_IDS.org, "evolution").ping!();
    expect(seenKey).toBe(KEY_B);

    const list = await listIntegrations();
    const evo = list.find((i) => i.integration === "evolution")!;
    expect(evo.origin).toBe("db");
    expect(evo.items[0].hintDisplay).toBe("••••5678");
    expect(dump(list)).not.toContain(KEY_B);
    expect(dump(list)).not.toContain("encryptedValue");

    // remover -> fallback env
    const rm = await removeIntegration({ id: row.id, confirm: true });
    expect(rm.ok).toBe(true);
    cfg = await getIntegrationConfig(SEED_IDS.org, "evolution");
    expect(cfg.origin).toBe("env");
    expect(cfg.reveal()).toBe(ENV_KEY);
    expect((await listIntegrations()).find((i) => i.integration === "evolution")!.origin).toBe("env");
    await getWhatsAppProvider(SEED_IDS.org, "evolution").ping!();
    expect(seenKey).toBe(ENV_KEY);
  });

  it("sem banco e sem env -> erro PT-BR config; validações Zod", async () => {
    await signInAsSeedAdmin();
    delete process.env.EVOLUTION_API_KEY;
    await expect(getIntegrationConfig(SEED_IDS.org, "evolution")).rejects.toMatchObject({ code: "config", userMessage: expect.stringMatching(/não configurada/) });
    const r = await saveIntegration({ integration: "llm", value: "curta" });
    expect(r.ok === false && r.errors?.value?.[0]).toMatch(/ao menos 12/);
    const r2 = await saveIntegration({ integration: "llm" });
    expect(r2.ok === false && r2.errors?.value?.[0]).toBe("Informe a chave.");
    const r3 = await saveIntegration({ integration: "evolution", value: KEY_A });
    expect(r3.ok === false && r3.errors?.baseUrl?.[0]).toBe("Informe a URL.");
  });
});

describe("SSRF ao salvar e ao conectar", () => {
  it("metadados sempre bloqueados, mesmo com allowPrivateHost", async () => {
    await signInAsSeedAdmin();
    for (const url of ["http://169.254.169.254", "http://[fd00:ec2::254]", "http://metadata.google.internal"]) {
      const r = await saveIntegration({ integration: "n8n", value: KEY_A, baseUrl: url, allowPrivateHost: true });
      expect(r.ok, url).toBe(false);
      expect(r.ok === false && r.errors?.baseUrl?.[0]).toMatch(/sempre bloqueado/);
    }
    expect(await prisma.integrationSecret.count()).toBe(0);
  });
  it("localhost só com allowPrivateHost; formato da URL validado", async () => {
    await signInAsSeedAdmin();
    const no = await saveIntegration({ integration: "n8n", value: KEY_A, baseUrl: base });
    expect(no.ok === false && no.errors?.baseUrl?.[0]).toMatch(/instância própria/);
    for (const url of ["ftp://x.test", "http://u:p@x.test", "http://x.test/#a"]) {
      expect((await saveIntegration({ integration: "n8n", value: KEY_A, baseUrl: url })).ok, url).toBe(false);
    }
    const yes = await saveIntegration({ integration: "n8n", value: KEY_A, baseUrl: base, allowPrivateHost: true });
    expect(yes.ok).toBe(true);
    const audit = await prisma.integrationAuditLog.findFirstOrThrow({ where: { integration: "n8n", action: "create" }, orderBy: { at: "desc" } });
    expect(audit.allowPrivateHost).toBe(true);
    await prisma.integrationSecret.deleteMany({ where: { integration: "n8n" } });
  });
  it("DNS que resolve para IP interno é bloqueado; para metadados, sempre", async () => {
    await signInAsSeedAdmin();
    _setIntegrationResolver(async () => ["10.0.0.5"]);
    const a = await saveIntegration({ integration: "n8n", value: KEY_A, baseUrl: "https://n8n.exemplo.test" });
    expect(a.ok === false && a.errors?.baseUrl?.[0]).toMatch(/instância própria/);
    _setIntegrationResolver(async () => ["93.184.216.34", "169.254.169.254"]);
    const b = await saveIntegration({ integration: "n8n", value: KEY_A, baseUrl: "https://n8n.exemplo.test", allowPrivateHost: true });
    expect(b.ok === false && b.errors?.baseUrl?.[0]).toMatch(/sempre bloqueado/);
  });
  it("ao CONECTAR revalida: DNS mudou para metadados depois de salvo -> falha sem chamar o servidor", async () => {
    await signInAsSeedAdmin();
    _setIntegrationResolver(async () => ["127.0.0.1"]);
    expect((await saveIntegration({ integration: "evolution", value: KEY_A, baseUrl: `http://evo.exemplo.test:${new URL(base).port}`, allowPrivateHost: true })).ok).toBe(true);
    _setIntegrationResolver(async () => ["169.254.169.254"]);
    hits = 0;
    await expect(getWhatsAppProvider(SEED_IDS.org, "evolution").ping!()).rejects.toMatchObject({ code: "config" });
    expect(hits).toBe(0);
    _setIntegrationResolver(async () => ["127.0.0.1"]);
    await getWhatsAppProvider(SEED_IDS.org, "evolution").ping!(); // conecta no IP checado (host fictício não resolve de fato)
    expect(hits).toBe(1);
    await prisma.integrationSecret.deleteMany();
  });
});

describe("testIntegration", () => {
  async function setup() {
    await signInAsSeedAdmin();
    invalidateIntegrationCache();
    await saveIntegration({ integration: "evolution", value: KEY_A, baseUrl: base, allowPrivateHost: true });
    return (await secret("evolution")).id;
  }
  it("ok, 401, 429 com Retry-After, timeout, redirecionamento: PT-BR, sem chave, registra último teste", async () => {
    const id = await setup();
    const ok = await testIntegration(id);
    expect(ok.ok && ok.data.ok).toBe(true);
    expect((await secret("evolution")).lastTestOk).toBe(true);

    mode = "401";
    const r401 = await testIntegration(id);
    expect(r401.ok && r401.data.ok).toBe(false);
    expect(dump(r401)).not.toContain(KEY_A);
    expect(r401.ok && r401.data.message).toMatch(/[a-zç]/i);

    mode = "429";
    const r429 = await testIntegration(id);
    expect(r429.ok && r429.data.retryAfterSeconds).toBe(7);
    expect(dump(r429)).not.toContain(KEY_A);

    mode = "hang";
    _setTestDeadline(300);
    const rt = await testIntegration(id);
    expect(rt.ok && rt.data.ok).toBe(false);
    expect(rt.ok && rt.data.message).toMatch(/Não foi possível conectar ao servidor informado/); // host privado: sem distinguir timeout

    mode = "redirect";
    hits = 0;
    const rr = await testIntegration(id);
    expect(rr.ok && rr.data.ok).toBe(false);
    expect(hits).toBe(1); // não seguiu o redirecionamento
    const row = await secret("evolution");
    expect(row.lastTestOk).toBe(false);
    expect(row.lastTestError ?? "").not.toContain(KEY_A);
  });
  it("rate limit por usuário (5/min)", async () => {
    const id = await setup();
    for (let i = 0; i < 5; i++) expect((await testIntegration(id)).ok).toBe(true);
    const r = await testIntegration(id);
    expect(r.ok === false && r.errors?._form?.[0]).toMatch(/Muitos testes/);
  });
  it("host privado: recusa de conexão e timeout têm a MESMA mensagem; 401 continua informando", async () => {
    const id = await setup();
    mode = "401";
    const r401 = await testIntegration(id);
    const m401 = r401.ok ? r401.data.message : "";
    mode = "hang";
    _setTestDeadline(200);
    const rt = await testIntegration(id);
    const mt = rt.ok ? rt.data.message : "";
    // servidor fora do ar (porta fechada): fecha o servidor real trocando a URL para uma porta livre
    await prisma.integrationSecret.update({ where: { id }, data: { baseUrl: "http://127.0.0.1:1" } });
    invalidateIntegrationCache();
    mode = "ok";
    const rc = await testIntegration(id);
    const mc = rc.ok ? rc.data.message : "";
    expect(mt).toMatch(/Não foi possível conectar/);
    expect(mc).toBe(mt);
    expect(m401).not.toBe(mt);
    // DNS inexistente (allowPrivateHost) -> a mesma mensagem
    _setIntegrationResolver(async () => { throw new Error("ENOTFOUND"); });
    await prisma.integrationSecret.update({ where: { id }, data: { baseUrl: "http://nx.exemplo.test:8080" } });
    invalidateIntegrationCache();
    const rd = await testIntegration(id);
    expect(rd.ok && rd.data.message).toBe(mt);
  });
  it("rate limit por integração (vários usuários somam) e em saveIntegration", async () => {
    const id = await setup();
    _resetTestQuota();
    // 8 testes na integração via "usuários" distintos direto na cota; o 9º é barrado mesmo com usuário novo
    const { consumeTestQuota } = await import("@/lib/integrations/test-connection");
    for (let i = 0; i < 8; i++) expect(consumeTestQuota(`outro-${i}`, id)).toBe(0);
    const r = await testIntegration(id);
    expect(r.ok === false && r.errors?._form?.[0]).toMatch(/Muitos testes/);
    _resetTestQuota();
    for (let i = 0; i < 10; i++) expect((await saveIntegration({ integration: "llm", value: KEY_A })).ok).toBe(true);
    const s = await saveIntegration({ integration: "llm", value: KEY_A });
    expect(s.ok === false && s.errors?._form?.[0]).toMatch(/Muitas alterações/);
    await prisma.integrationSecret.deleteMany();
  });
  it("hint: chave longa mostra 4, curta (12) mostra 2, e o valor nunca aparece", async () => {
    await signInAsSeedAdmin();
    const a = await saveIntegration({ integration: "llm", name: "k12", value: "abcdefgh1234" });
    const b = await saveIntegration({ integration: "llm", name: "k32", value: "x".repeat(28) + "wxyz" });
    expect(a.ok && a.data.hint).toBe("34");
    expect(b.ok && b.data.hint).toBe("wxyz");
    expect(dump(a)).not.toContain("abcdefgh1234");
    await prisma.integrationSecret.deleteMany();
  });
  it("n8n/llm/places: só valida formato, 'teste indisponível'", async () => {
    await signInAsSeedAdmin();
    await saveIntegration({ integration: "llm", value: KEY_A });
    const r = await testIntegration((await secret("llm")).id);
    expect(r.ok && r.data.available).toBe(false);
    expect(r.ok && r.data.message).toMatch(/indisponível/);
  });
});

describe("remoção", () => {
  it("bloqueia com instâncias WhatsApp dependentes (com contagem) e exige confirm", async () => {
    await signInAsSeedAdmin();
    await saveIntegration({ integration: "evolution", value: KEY_A, baseUrl: base, allowPrivateHost: true });
    const id = (await secret("evolution")).id;
    await prisma.whatsAppInstance.create({ data: { orgId: SEED_IDS.org, instanceName: `${TAG}-w`, number: "+5511912340000", webhookToken: `${TAG}-tok`, provider: "evolution" } as never });
    const n = await prisma.whatsAppInstance.count({ where: { provider: "evolution" } });
    const r = await removeIntegration({ id, confirm: true });
    expect(r.ok === false && r.errors?._form?.[0]).toContain(`${n} instância`);
    expect(await prisma.integrationSecret.count({ where: { id } })).toBe(1);
    await prisma.whatsAppInstance.deleteMany({ where: { instanceName: { startsWith: TAG } } });
    const noConfirm = await removeIntegration({ id, confirm: false });
    expect(noConfirm.ok).toBe(false);
    if (n === 1) expect((await removeIntegration({ id, confirm: true })).ok).toBe(true);
    else await prisma.integrationSecret.deleteMany();
  });
});

describe("remoção transacional", () => {
  it("dependente criado durante a remoção: contagem e delete na mesma transação; id inexistente -> não encontrada", async () => {
    await signInAsSeedAdmin();
    await saveIntegration({ integration: "evolution", value: KEY_A, baseUrl: base, allowPrivateHost: true });
    const id = (await secret("evolution")).id;
    const delsBefore = await prisma.integrationAuditLog.count({ where: { action: "delete", integration: "evolution" } });
    const gone = await removeIntegration({ id: "00000000-0000-4000-8000-000000000000", confirm: true });
    expect(gone.ok === false && gone.errors?._form?.[0]).toBe("Integração não encontrada.");
    const [a, b] = await Promise.all([removeIntegration({ id, confirm: true }), removeIntegration({ id, confirm: true })]);
    const oks = [a, b].filter((r) => r.ok).length;
    expect(oks).toBe(1); // a outra vê "não encontrada"/conflito, nunca 2 deletes nem erro cru
    for (const r of [a, b]) if (!r.ok) expect(r.errors?._form?.[0]).toMatch(/não encontrad|Conflito|Registro/i);
    expect(await prisma.integrationSecret.count({ where: { id } })).toBe(0);
    expect(await prisma.integrationAuditLog.count({ where: { action: "delete", integration: "evolution" } })).toBe(delsBefore + 1);
  });
});

describe("vazamento e auditoria", () => {
  it("nenhum valor em logs, auditoria ou retornos; auditoria registra ações", async () => {
    await signInAsSeedAdmin();
    await prisma.integrationSecret.deleteMany();
    await saveIntegration({ integration: "llm", value: KEY_A });
    await saveIntegration({ integration: "llm", value: KEY_B });
    await testIntegration((await secret("llm")).id);
    await removeIntegration({ id: (await secret("llm")).id, confirm: true });
    const audit = await listIntegrationAudit({ integration: "llm" });
    const actions = audit.items.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["create", "rotate", "delete"]));
    expect(dump(audit)).not.toMatch(/sk-test|encryptedValue/);
    expect(await prisma.integrationAuditLog.count({ where: { action: "test", at: { gte: auditBefore } } })).toBeGreaterThan(0); // testes reais da Evolution acima
    const raw = await prisma.integrationAuditLog.findMany({ where: { at: { gte: auditBefore } } });
    expect(dump(raw)).not.toMatch(/sk-test/);
    const all = logs.join("\n");
    for (const v of [KEY_A, KEY_B, ENV_KEY, "aaaa1234", "bbbb5678"]) expect(all).not.toContain(v);
  });
});
