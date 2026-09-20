import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { spec } from "@/lib/openapi";
import { signAccessToken } from "./token";
import { _clearActionLimit, ACTION_MAX } from "./action-limit";
import { maskDisplayName } from "./actions";
import { POST as pause } from "@/app/api/mobile/v1/campaigns/[id]/pause/route";
import { POST as resume } from "@/app/api/mobile/v1/campaigns/[id]/resume/route";
import { PUT as killSwitch } from "@/app/api/mobile/v1/agents/kill-switch/route";
import { GET as listDrafts } from "@/app/api/mobile/v1/drafts/route";
import { GET as getDraft } from "@/app/api/mobile/v1/drafts/[id]/route";
import { POST as approve } from "@/app/api/mobile/v1/drafts/[id]/approve/route";
import { POST as reject } from "@/app/api/mobile/v1/drafts/[id]/reject/route";
import { POST as take } from "@/app/api/mobile/v1/handoffs/[leadId]/take/route";

const sendMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/channels/whatsapp", async (orig) => {
  const actual = await orig<typeof import("@/lib/channels/whatsapp")>();
  sendMock.fn.mockImplementation(actual.sendWhatsApp);
  return { ...actual, sendWhatsApp: (...a: Parameters<typeof actual.sendWhatsApp>) => sendMock.fn(...a) };
});

const TAG = "zz-spec026";
const PASS = "Senha-Forte-Teste-123";
const LEAD_NAME = "Carolina Figueiredo Teste";
const LEAD_EMAIL = `carol@${TAG}.example.com`;
const BODY = "Olá! ".padEnd(400, "x");
let userId = "", devA = "", tokA = "", tokUser2 = "";
let campId = "", agentId = "", nonAdminId = "";
let prevSettings: { killSwitch: boolean } | null = null;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const lctx = (leadId: string) => ({ params: Promise.resolve({ leadId }) });
const req = (method: string, tok: string | null, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api", { method, headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
let n = 0;
async function mkLead(over: Record<string, unknown> = {}) {
  n++;
  return prisma.lead.create({ data: { campaignId: campId, name: LEAD_NAME, email: `l${n}-${LEAD_EMAIL}`, phone: `+551198${String(7000000 + n)}`, sequenceStatus: "active", ...over } });
}
async function mkDraft(leadId: string, body = BODY) {
  const run = await prisma.agentRun.create({ data: { agentId, leadId, trigger: `${TAG}-${Math.random()}`, status: "completed" } });
  return prisma.draft.create({ data: { agentRunId: run.id, leadId, channel: "whatsapp", body } });
}
async function mkDevice(uid: string) {
  const d = await prisma.mobileDevice.create({ data: { userId: uid, name: TAG, platform: "android", refreshHash: `h-${crypto.randomUUID()}`, refreshExpiresAt: new Date(Date.now() + 1e9) } });
  return { id: d.id, tok: await signAccessToken(uid, d.id) };
}

async function cleanup() {
  await prisma.mobileActionLog.deleteMany({ where: { userId: { in: [userId, nonAdminId].filter(Boolean) } } });
  await prisma.mobileAlert.deleteMany({ where: { dedupeKey: { startsWith: TAG } } });
  await prisma.suppression.deleteMany({ where: { value: { contains: TAG } } });
  await prisma.lead.deleteMany({ where: { campaign: { name: { startsWith: TAG } } } });
  await prisma.campaign.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.agent.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await cleanup();
  userId = (await prisma.user.create({ data: { name: "Adm", email: `${TAG}@leadforge.local`, role: "admin", passwordHash: await hashPassword(PASS) } })).id;
  nonAdminId = (await prisma.user.create({ data: { name: "U2", email: `${TAG}-2@leadforge.local`, role: "user", passwordHash: await hashPassword(PASS) } })).id;
  const d = await mkDevice(userId);
  devA = d.id; tokA = d.tok;
  tokUser2 = (await mkDevice(nonAdminId)).tok;
  const icp = await prisma.icpProfile.create({ data: { name: `${TAG}-icp`, niche: "n" } });
  campId = (await prisma.campaign.create({ data: { name: `${TAG}-camp`, icpId: icp.id, userId } })).id;
  agentId = (await prisma.agent.create({ data: { role: "sdr", name: `${TAG}-sdr`, active: true, monthlyBudgetCents: 1000, allowedTools: [] } })).id;
  prevSettings = await prisma.agentSettings.findUnique({ where: { id: "global" } });
}, 30000);
beforeEach(async () => {
  _clearActionLimit();
  sendMock.fn.mockClear();
  await prisma.mobileActionLog.deleteMany({ where: { userId } });
  await prisma.campaign.update({ where: { id: campId }, data: { status: "active" } });
});
afterAll(async () => {
  await cleanup();
  await prisma.mobileDevice.deleteMany({ where: { userId: { in: [userId, nonAdminId] } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await prisma.icpProfile.deleteMany({ where: { name: `${TAG}-icp` } });
  if (prevSettings) await prisma.agentSettings.update({ where: { id: "global" }, data: { killSwitch: prevSettings.killSwitch } });
  else await prisma.agentSettings.deleteMany({});
});

describe("auth e entrada", () => {
  it("sem Bearer = 401 em todas as acoes; id invalido = 404; Idempotency-Key invalida = 400", async () => {
    expect((await pause(req("POST", null), ctx(campId))).status).toBe(401);
    expect((await killSwitch(req("PUT", null, { killSwitch: true }))).status).toBe(401);
    expect((await reject(req("POST", null, { reason: "x" }), ctx(campId))).status).toBe(401);
    expect((await take(req("POST", null), lctx(campId))).status).toBe(401);
    expect((await pause(req("POST", tokA), ctx("nao-uuid"))).status).toBe(404);
    expect((await pause(req("POST", tokA, undefined, { "idempotency-key": "curta" }), ctx(campId))).status).toBe(400);
  });
  it("dispositivo revogado = 401", async () => {
    const d = await mkDevice(userId);
    await prisma.mobileDevice.update({ where: { id: d.id }, data: { revokedAt: new Date() } });
    expect((await pause(req("POST", d.tok), ctx(campId))).status).toBe(401);
  });
});

describe("campanha pausar/retomar (AC1, AC2)", () => {
  it("pausa e retoma; repetir devolve o mesmo estado (idempotente)", async () => {
    for (let i = 0; i < 2; i++) {
      const r = await pause(req("POST", tokA), ctx(campId));
      expect(r.status).toBe(200);
      expect((await r.json()).data).toEqual({ id: campId, status: "paused" });
    }
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campId } })).status).toBe("paused");
    const r = await resume(req("POST", tokA), ctx(campId));
    expect((await r.json()).data.status).toBe("active");
  });
  it("arquivada = 409 PT-BR; inexistente = 404", async () => {
    await prisma.campaign.update({ where: { id: campId }, data: { status: "archived" } });
    const r = await resume(req("POST", tokA), ctx(campId));
    expect(r.status).toBe(409);
    expect((await r.json()).error.message).toMatch(/arquivada/);
    expect((await pause(req("POST", tokA), ctx(crypto.randomUUID()))).status).toBe(404);
  });
  it("AC2: retomar so muda o status; nao cria toque nem envia (limites/aquecimento seguem no envio)", async () => {
    const lead = await mkLead();
    await pause(req("POST", tokA), ctx(campId));
    await resume(req("POST", tokA), ctx(campId));
    expect(sendMock.fn).not.toHaveBeenCalled();
    expect(await prisma.touch.count({ where: { leadId: lead.id } })).toBe(0);
  });
});

describe("rascunhos: listar/detalhe (D-M6)", () => {
  it("lista truncada em 280, nome mascarado, sem contato; detalhe traz corpo completo", async () => {
    const lead = await mkLead();
    const d = await mkDraft(lead.id);
    const r = await listDrafts(req("GET", tokA));
    expect(r.headers.get("cache-control")).toBe("no-store");
    const txt = await r.text();
    const item = (JSON.parse(txt).data as Array<{ id: string; preview: string; truncated: boolean; displayName: string; channel: string }>).find((x) => x.id === d.id)!;
    expect(item.preview.length).toBe(280);
    expect(item.truncated).toBe(true);
    expect(item.displayName).toBe("Carolina T.");
    expect(item.channel).toBe("whatsapp");
    for (const pii of [LEAD_NAME, LEAD_EMAIL, "@", "+5511", lead.phone ?? "zz"]) expect(txt).not.toContain(pii);
    expect(txt).not.toContain(BODY);
    const det = await getDraft(req("GET", tokA), ctx(d.id));
    expect(det.headers.get("cache-control")).toBe("no-store");
    const dj = (await det.json()).data;
    expect(dj.body).toBe(BODY);
    expect(dj.displayName).toBe("Carolina T.");
    expect(JSON.stringify(dj)).not.toContain(LEAD_EMAIL);
    expect((await getDraft(req("GET", tokA), ctx(crypto.randomUUID()))).status).toBe(404);
  });
  it("status diferente de pending = 400; maskDisplayName", async () => {
    expect((await listDrafts(new Request("http://x/api?status=sent", { headers: { authorization: `Bearer ${tokA}` } }))).status).toBe(400);
    expect(maskDisplayName("Ana")).toBe("A•••");
    expect(maskDisplayName("  ")).toBe("Lead");
  });
});

describe("aprovar/rejeitar (AC1, AC3)", () => {
  it("AC1: com Idempotency-Key o segundo toque replica a resposta e envia UMA vez", async () => {
    sendMock.fn.mockResolvedValueOnce({ status: "sent" });
    const d = await mkDraft((await mkLead()).id);
    const h = { "idempotency-key": "key-approve-0001" };
    const r1 = await approve(req("POST", tokA, undefined, h), ctx(d.id));
    const r2 = await approve(req("POST", tokA, undefined, h), ctx(d.id));
    expect(r1.status).toBe(200);
    expect((await r1.json()).data).toEqual({ id: d.id, status: "sent" });
    expect(r2.status).toBe(200);
    expect(r2.headers.get("idempotent-replayed")).toBe("true");
    expect((await r2.json()).data.status).toBe("sent");
    expect(sendMock.fn).toHaveBeenCalledTimes(1);
    expect(await prisma.mobileActionLog.count({ where: { userId, action: "draft.approve" } })).toBe(1);
  });
  it("AC1: sem chave o segundo toque = 409 e nao envia de novo", async () => {
    sendMock.fn.mockResolvedValueOnce({ status: "sent" });
    const d = await mkDraft((await mkLead()).id);
    expect((await approve(req("POST", tokA), ctx(d.id))).status).toBe(200);
    const r2 = await approve(req("POST", tokA), ctx(d.id));
    expect(r2.status).toBe(409);
    expect((await r2.json()).error.message).toMatch(/já foi tratado/);
    expect(sendMock.fn).toHaveBeenCalledTimes(1);
  });
  it("AC3: lead em opt-out = 409 e nada enviado", async () => {
    const lead = await mkLead({ optedOutAt: new Date(), sequenceStatus: "opted_out" });
    const d = await mkDraft(lead.id);
    const r = await approve(req("POST", tokA), ctx(d.id));
    expect(r.status).toBe(409);
    expect((await r.json()).error.message).toMatch(/[A-Za-zÀ-ú]/);
    expect((await prisma.draft.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("blocked");
    expect(await prisma.touch.count({ where: { leadId: lead.id, status: "sent" } })).toBe(0);
  });
  it("AC3: lead em supressao = 409 e nada enviado", async () => {
    const lead = await mkLead({ email: `sup-${TAG}@example.com` });
    await prisma.suppression.create({ data: { kind: "email", value: `sup-${TAG}@example.com`, reason: "manual" } });
    const d = await mkDraft(lead.id);
    expect((await approve(req("POST", tokA), ctx(d.id))).status).toBe(409);
    expect(await prisma.touch.count({ where: { leadId: lead.id, status: "sent" } })).toBe(0);
  });
  it("rejeitar: motivo obrigatorio (400); rejeita; segundo = 409; inexistente = 404", async () => {
    const d = await mkDraft((await mkLead()).id);
    expect((await reject(req("POST", tokA, {}), ctx(d.id))).status).toBe(400);
    const r = await reject(req("POST", tokA, { reason: "Tom inadequado" }), ctx(d.id));
    expect((await r.json()).data).toEqual({ id: d.id, status: "rejected" });
    const row = await prisma.draft.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.status).toBe("rejected");
    expect(row.reviewedBy).toBe(userId);
    expect((await reject(req("POST", tokA, { reason: "x" }), ctx(d.id))).status).toBe(409);
    expect((await reject(req("POST", tokA, { reason: "x" }), ctx(crypto.randomUUID()))).status).toBe(404);
  });
});

describe("kill switch com reautenticacao (AC4)", () => {
  it("parar (true) funciona sem senha; ligar agentes (false) exige senha correta", async () => {
    await prisma.agentSettings.upsert({ where: { id: "global" }, create: { id: "global", killSwitch: false }, update: { killSwitch: false } });
    const off = await killSwitch(req("PUT", tokA, { killSwitch: true }));
    expect(off.status).toBe(200);
    expect((await off.json()).data).toEqual({ killSwitch: true });
    expect((await prisma.agentSettings.findUniqueOrThrow({ where: { id: "global" } })).killSwitch).toBe(true);

    const noPw = await killSwitch(req("PUT", tokA, { killSwitch: false }));
    expect(noPw.status).toBe(403);
    expect((await noPw.json()).error.code).toBe("reauth_required");
    expect((await killSwitch(req("PUT", tokA, { killSwitch: false, password: "errada" }))).status).toBe(403);
    expect((await prisma.agentSettings.findUniqueOrThrow({ where: { id: "global" } })).killSwitch).toBe(true);

    const on = await killSwitch(req("PUT", tokA, { killSwitch: false, password: PASS }));
    expect(on.status).toBe(200);
    expect((await on.json()).data).toEqual({ killSwitch: false });
    expect((await prisma.agentSettings.findUniqueOrThrow({ where: { id: "global" } })).killSwitch).toBe(false);
    expect((await prisma.mobileActionLog.findMany({ where: { userId } })).some((l) => JSON.stringify(l).includes(PASS))).toBe(false);
  });
  it("senha errada repetida bloqueia (429); nao-admin = 403; corpo invalido = 400", async () => {
    for (let i = 0; i < 5; i++) await killSwitch(req("PUT", tokA, { killSwitch: false, password: "errada" }));
    const r = await killSwitch(req("PUT", tokA, { killSwitch: false, password: PASS }));
    expect(r.status).toBe(429);
    expect((await killSwitch(req("PUT", tokUser2, { killSwitch: true }))).status).toBe(403);
    expect((await killSwitch(req("PUT", tokA, { killSwitch: "sim" }))).status).toBe(400);
  });
});

describe("handoff: assumir (AC5)", () => {
  it("agente para no lead, rascunhos pendentes expiram, sem telefone/e-mail, devolve link da call", async () => {
    const lead = await mkLead();
    const d = await mkDraft(lead.id);
    await prisma.mobileAlert.create({ data: { kind: "handoff", severity: "alta", dedupeKey: `${TAG}:h:${lead.id}`, title: "t", body: "b", refType: "lead", refId: lead.id, link: "https://meet.example.com/call" } });
    const r = await take(req("POST", tokA), lctx(lead.id));
    const txt = await r.text();
    const j = JSON.parse(txt).data;
    expect(r.status).toBe(200);
    expect(j.agentStopped).toBe(true);
    expect(j.link).toBe("https://meet.example.com/call");
    for (const pii of [lead.email, lead.phone ?? "zz", LEAD_NAME]) expect(txt).not.toContain(pii);
    const row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.handoffAt).not.toBeNull();
    expect(row.sequenceStatus).toBe("paused_manual");
    expect((await prisma.draft.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("expired");
    const again = await take(req("POST", tokA), lctx(lead.id));
    expect(again.status).toBe(200);
    expect((await again.json()).data.agentStopped).toBe(true);
    expect((await take(req("POST", tokA), lctx(crypto.randomUUID()))).status).toBe(404);
  });
});

describe("auditoria e rate limit (AC6)", () => {
  it("cada acao grava userId/deviceId/acao/alvo/resultado, sem PII nem corpo/motivo/senha", async () => {
    const lead = await mkLead();
    const d = await mkDraft(lead.id);
    await reject(req("POST", tokA, { reason: "motivo-secreto-abc" }), ctx(d.id));
    await pause(req("POST", tokA), ctx(campId));
    await take(req("POST", tokA), lctx(lead.id));
    await killSwitch(req("PUT", tokA, { killSwitch: false, password: "senha-errada-xyz" }));
    const logs = await prisma.mobileActionLog.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["draft.reject", "campaign.pause", "handoff.take", "agents.kill_switch_off"]);
    expect(logs.every((l) => l.userId === userId && l.deviceId === devA && !!l.outcome)).toBe(true);
    expect(logs[0].target).toBe(d.id);
    expect(logs[3].outcome).toBe("403:reauth_required");
    const dump = JSON.stringify(logs);
    for (const s of ["motivo-secreto-abc", "senha-errada-xyz", LEAD_NAME, lead.email, lead.phone ?? "zz", "Olá"]) expect(dump).not.toContain(s);
  });
  it("rate limit por dispositivo: acima do teto = 429 com Retry-After; outro dispositivo nao e afetado", async () => {
    for (let i = 0; i < ACTION_MAX; i++) expect((await pause(req("POST", tokA), ctx(campId))).status).toBe(200);
    const r = await pause(req("POST", tokA), ctx(campId));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    const other = await mkDevice(userId);
    expect((await pause(req("POST", other.tok), ctx(campId))).status).toBe(200);
  });
});

describe("contrato e escopo (AC7)", () => {
  const root = path.join(process.cwd(), "src/app/api/mobile/v1");
  function routes(dir: string, acc: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) routes(p, acc);
      else if (f === "route.ts") acc.push("/" + path.relative(root, dir).split(path.sep).join("/"));
    }
    return acc;
  }
  const ALLOW = [
    "/agents/kill-switch", "/agents/queue", "/alerts", "/alerts/[id]/read", "/alerts/read-all", "/alerts/unread-count",
    "/auth/login", "/auth/logout", "/auth/me", "/auth/refresh", "/campaigns", "/campaigns/[id]", "/campaigns/[id]/pause", "/campaigns/[id]/resume",
    "/devices", "/devices/[id]", "/devices/push-token", "/drafts", "/drafts/[id]", "/drafts/[id]/approve", "/drafts/[id]/reject",
    "/handoffs/[leadId]/take", "/lead-search/runs", "/pipeline", "/scheduler", "/summary", "/whatsapp/instances",
  ];
  it("as rotas de /api/mobile/v1 sao exatamente a allowlist (nada da lista FORA da SPEC-026)", () => {
    expect(routes(root).sort()).toEqual([...ALLOW].sort());
  });
  it("nenhuma rota de criar/editar/excluir/importar/integracoes/autonomia/supressao", () => {
    const bad = /template|sequence|icp|integration|autonomy|import|suppress|leads|delete|create|edit/i;
    expect(routes(root).filter((r) => bad.test(r))).toEqual([]);
  });
  it("OpenAPI documenta todas as acoes da SPEC-026", () => {
    const paths = Object.keys(spec.paths!);
    for (const p of ["/campaigns/{id}/pause", "/campaigns/{id}/resume", "/agents/kill-switch", "/drafts", "/drafts/{id}", "/drafts/{id}/approve", "/drafts/{id}/reject", "/handoffs/{leadId}/take"]) expect(paths).toContain(p);
  });
});
