import "dotenv/config";
import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.AUTH_URL = "http://app.test";
// Nestes testes o SMTP é falso/local; o bloqueio anti-SSRF é testado em ssrf.test.ts e no describe "SSRF" abaixo.
process.env.ALLOW_PRIVATE_SMTP_HOSTS = "true";

import { prisma } from "@/lib/prisma";
import { signInAsSeedAdmin, signOut } from "@/lib/auth/test-helpers";
import { seed } from "../../../prisma/seed";
import { encrypt } from "@/lib/crypto/secret-box";
import { nextSendWindow, normalizeSmtpError, pickEmailAccount, sendEmail, startOfDaySP, type SmtpConfig } from "./email";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";
import { _resetUnsubscribeRateLimit } from "./unsubscribe-rate-limit";
import { GET, POST } from "@/app/api/webhooks/unsubscribe/[token]/route";
import { createEmailAccount, deleteEmailAccount, setActive, testEmailConnection, updateEmailAccount } from "@/lib/actions/email";
import { getEmailAccount, listEmailAccounts } from "@/lib/queries/email";

const TAG = "zz-test-spec010";
const PASS = "SuperSecretPass!42";
let userId = "";
let campId = "";
let tplId = "";
let stepId = "";
let acc1 = "";
let acc2 = "";
let n = 0;

async function mkLead(over: Record<string, unknown> = {}) {
  n++;
  return prisma.lead.create({ data: { campaignId: campId, name: `Ana ${n}`, email: `l${n}@${TAG}.com`, ...over } });
}
async function mkTouch(leadId: string, over: Record<string, unknown> = {}) {
  return prisma.touch.create({ data: { leadId, channel: "email", stepId, status: "scheduled", ...over } });
}
const json = () => nodemailer.createTransport({ jsonTransport: true });
const params = (t: string) => ({ params: Promise.resolve({ token: t }) });
const req = (m: string, ip = "9.9.9.9") => new Request("http://x/api/webhooks/unsubscribe/t", { method: m, headers: { "x-real-ip": ip } });

beforeAll(async () => {
  process.env.TRUSTED_PROXY_IP_HEADER = "x-real-ip";
  await seed(prisma);
  await signInAsSeedAdmin();
  const user = await prisma.user.findFirstOrThrow({ where: { email: "admin@leadforge.local" } });
  userId = user.id;
  const icp = await prisma.icpProfile.findFirstOrThrow();
  const seq = await prisma.sequence.create({ data: { name: TAG } });
  campId = (await prisma.campaign.create({ data: { name: TAG, userId, icpId: icp.id, sequenceId: seq.id } })).id;
  tplId = (await prisma.messageTemplate.create({ data: { campaignId: campId, channel: "email", name: TAG, subject: "Oi {{firstName}}", body: "Olá {{name}} da {{company}}" } })).id;
  stepId = (await prisma.sequenceStep.create({ data: { sequenceId: seq.id, day: 0, channel: "email", templateId: tplId, order: 1 } })).id;
  const mk = (email: string, over = {}) =>
    prisma.emailAccount.create({ data: { userId, provider: "smtp", smtpHost: "smtp.interno.local", email, encryptedPassword: encrypt(PASS), ...over } });
  acc1 = (await mk(`a1@${TAG}.com`, { dailyLimit: 100, fromName: "Time Zz" })).id;
  acc2 = (await mk(`a2@${TAG}.com`, { isActive: false })).id;
}, 30000);

afterAll(async () => {
  await prisma.suppression.deleteMany({ where: { value: { contains: TAG } } });
  await prisma.lead.deleteMany({ where: { campaignId: campId } });
  await prisma.emailAccount.deleteMany({ where: { email: { contains: TAG } } });
  await prisma.sequenceStep.deleteMany({ where: { id: stepId } });
  await prisma.campaign.deleteMany({ where: { id: campId } });
  await prisma.sequence.deleteMany({ where: { name: TAG } });
  await prisma.$disconnect();
});

describe("sendEmail", () => {
  it("envia com headers/rodapé, atualiza Touch e é idempotente; senha só decifrada no envio", async () => {
    const lead = await mkLead({ company: "Acme" });
    const t = await mkTouch(lead.id);
    let cfg: SmtpConfig | undefined;
    const tr = json();
    const r = await sendEmail(t.id, { createTransport: (c) => ((cfg = c), tr) });
    expect(r.status).toBe("sent");
    expect(cfg?.auth.pass).toBe(PASS);
    const db = await prisma.touch.findUniqueOrThrow({ where: { id: t.id } });
    expect(db.status).toBe("sent");
    expect(db.sentAt).toBeTruthy();
    expect(db.externalId).toBeTruthy();
    expect(db.emailAccountId).toBe(acc1);
    expect(JSON.stringify(r) + JSON.stringify(db)).not.toContain(PASS);
    const again = await sendEmail(t.id, { transport: tr });
    expect(again.status).toBe("already_sent");
  });

  it("mensagem: List-Unsubscribe, One-Click, rodapé PT-BR, assunto renderizado", async () => {
    const lead = await mkLead({ company: "Acme" });
    const t = await mkTouch(lead.id);
    const tr = json();
    const spy = vi.spyOn(tr, "sendMail");
    await sendEmail(t.id, { transport: tr });
    const m = spy.mock.calls[0][0] as { headers: Record<string, string>; text: string; subject: string; from: { name: string } };
    expect(m.headers["List-Unsubscribe"]).toMatch(/^<http:\/\/app\.test\/api\/webhooks\/unsubscribe\/.+>$/);
    expect(m.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(m.text).toContain("Para não receber mais e-mails");
    expect(m.text).toContain("Olá Ana");
    expect(m.subject).toMatch(/^Oi Ana/);
    expect(m.from.name).toBe("Time Zz");
  });

  it("lead sem e-mail = failed tratado", async () => {
    const lead = await mkLead({ email: null });
    const t = await mkTouch(lead.id);
    const r = await sendEmail(t.id, { transport: json() });
    expect(r.status).toBe("failed");
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("failed");
  });

  it("opted_out/completed não envia", async () => {
    const l1 = await mkLead({ optedOutAt: new Date(), sequenceStatus: "opted_out" });
    const l2 = await mkLead({ sequenceStatus: "completed" });
    const tr = json();
    const spy = vi.spyOn(tr, "sendMail");
    expect((await sendEmail((await mkTouch(l1.id)).id, { transport: tr })).status).toBe("skipped");
    expect((await sendEmail((await mkTouch(l2.id)).id, { transport: tr })).status).toBe("skipped");
    expect(spy).not.toHaveBeenCalled();
  });

  it("falha SMTP marca failed com erro sanitizado e sem vazar host/senha", async () => {
    const lead = await mkLead();
    const t = await mkTouch(lead.id);
    const tr = json();
    vi.spyOn(tr, "sendMail").mockRejectedValue(Object.assign(new Error(`connect smtp.interno.local ${PASS}`), { code: "ECONNECTION" }));
    const r = await sendEmail(t.id, { transport: tr });
    expect(r.status).toBe("failed");
    if (r.status === "failed") expect(r.error.retryable).toBe(true);
    const db = await prisma.touch.findUniqueOrThrow({ where: { id: t.id } });
    expect(db.status).toBe("failed");
    expect(db.error).not.toMatch(/interno|Secret/);
  });
});

describe("normalizeSmtpError", () => {
  const c = (code?: string, responseCode?: number) => normalizeSmtpError(Object.assign(new Error("host.x senha"), { code, responseCode }));
  it("mapeia códigos e retryable", () => {
    expect(c("EAUTH").retryable).toBe(false);
    expect(c("ECONNECTION").retryable).toBe(true);
    expect(c("ETIMEDOUT").retryable).toBe(true);
    expect(c("ESOCKET").retryable).toBe(true);
    expect(c("EENVELOPE").retryable).toBe(false);
    expect(c("EMESSAGE", 554).retryable).toBe(false);
    expect(c("EMESSAGE", 451).retryable).toBe(true);
    expect(c(undefined, 450).retryable).toBe(true);
    expect(c(undefined, 550).retryable).toBe(false);
    expect(c("EAUTH").userMessage).not.toMatch(/host\.x|senha$/);
  });
});

describe("limite diário [D15]", () => {
  it("dailyLimit 2: 3º é adiado sem enviar; virada de dia libera", async () => {
    await prisma.emailAccount.update({ where: { id: acc1 }, data: { dailyLimit: 2 } });
    const now = new Date("2026-03-10T15:00:00Z"); // 12:00 SP
    const tr = json();
    const spy = vi.spyOn(tr, "sendMail");
    const res = [];
    for (let i = 0; i < 3; i++) {
      const lead = await mkLead();
      res.push(await sendEmail((await mkTouch(lead.id)).id, { transport: tr, now }));
    }
    expect(res.map((r) => r.status)).toEqual(["sent", "sent", "deferred"]);
    const d = res[2];
    if (d.status === "deferred") expect(d.nextAt.toISOString()).toBe("2026-03-11T11:00:00.000Z"); // 08:00 SP
    expect(spy).toHaveBeenCalledTimes(2);
    const deferred = await prisma.touch.findFirstOrThrow({ where: { status: "scheduled", scheduledAt: new Date("2026-03-11T11:00:00Z"), lead: { campaignId: campId } } });
    expect(deferred).toBeTruthy();
    const next = await pickEmailAccount(userId, new Date("2026-03-11T11:00:00Z"));
    expect(next.status).toBe("ok");
    const sameDay = await pickEmailAccount(userId, new Date("2026-03-10T23:59:00-03:00"));
    expect(sameDay.status).toBe("deferred");
  });

  it("rodízio: escolhe a conta com menos envios; sem conta ativa", async () => {
    const now = new Date("2026-04-10T15:00:00Z");
    await setActive({ id: acc2, isActive: true });
    await prisma.emailAccount.update({ where: { id: acc2 }, data: { dailyLimit: 5 } });
    const lead = await mkLead();
    await prisma.touch.create({ data: { leadId: lead.id, channel: "email", status: "sent", sentAt: now, emailAccountId: acc1 } });
    const p = await pickEmailAccount(userId, now);
    expect(p.status === "ok" && p.account.id).toBe(acc2);
    await prisma.emailAccount.updateMany({ where: { id: { in: [acc1, acc2] } }, data: { isActive: false } });
    expect((await pickEmailAccount(userId, now)).status).toBe("no_account");
    await prisma.emailAccount.update({ where: { id: acc1 }, data: { isActive: true } });
    await prisma.emailAccount.update({ where: { id: acc2 }, data: { isActive: false } });
  });

  it("helpers de fuso", () => {
    expect(startOfDaySP(new Date("2026-03-10T02:00:00Z")).toISOString()).toBe("2026-03-09T03:00:00.000Z");
    expect(nextSendWindow(new Date("2026-03-10T15:00:00Z")).toISOString()).toBe("2026-03-11T11:00:00.000Z");
  });
});

describe("descadastro", () => {
  it("token: válido, adulterado e expirado", () => {
    const t = createUnsubscribeToken("lead-1");
    expect(verifyUnsubscribeToken(t)).toBe("lead-1");
    expect(verifyUnsubscribeToken(t + "x")).toBeNull();
    expect(verifyUnsubscribeToken("a.b")).toBeNull();
    expect(verifyUnsubscribeToken("lixo")).toBeNull();
    expect(verifyUnsubscribeToken(createUnsubscribeToken("l", new Date("2020-01-01")))).toBeNull();
    expect(Buffer.from(t.split(".")[0], "base64url").toString()).not.toMatch(/@/);
  });

  it("GET sem efeito colateral; POST descadastra, encerra touches e é idempotente", async () => {
    _resetUnsubscribeRateLimit();
    const lead = await mkLead({ sequenceStatus: "active" });
    const t1 = await mkTouch(lead.id, { status: "pending", stepId: null });
    const sent = await prisma.touch.create({ data: { leadId: lead.id, channel: "email", status: "sent", sentAt: new Date() } });
    const tok = createUnsubscribeToken(lead.id);
    const g = await GET(req("GET"), params(tok));
    expect(g.status).toBe(200);
    expect(await g.text()).toContain("Confirmar");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).optedOutAt).toBeNull();
    expect((await POST(req("POST"), params(tok))).status).toBe(200);
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(l.sequenceStatus).toBe("opted_out");
    expect(l.optedOutAt).toBeTruthy();
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe("skipped");
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: sent.id } })).status).toBe("sent");
    expect((await POST(req("POST"), params(tok))).status).toBe(200);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).optedOutAt).toEqual(l.optedOutAt);
  });

  it("token inválido -> 400 PT-BR; rate limit -> 429 + Retry-After", async () => {
    _resetUnsubscribeRateLimit();
    const r = await POST(req("POST", "1.1.1.1"), params("invalido"));
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("inválido");
    let last: Response = r;
    for (let i = 0; i < 31; i++) last = await GET(req("GET", "1.1.1.1"), params("x"));
    expect(last.status).toBe(429);
    expect(Number(last.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await GET(req("GET", "2.2.2.2"), params("y"))).status).toBe(400);
    _resetUnsubscribeRateLimit();
  });

  it("sem IP confiável (unknown): tokens distintos não se bloqueiam; mesmo token é limitado; POST idempotente ok", async () => {
    _resetUnsubscribeRateLimit();
    const saved = process.env.TRUSTED_PROXY_IP_HEADER;
    delete process.env.TRUSTED_PROXY_IP_HEADER;
    try {
      for (let i = 0; i < 100; i++) expect((await GET(req("GET", `10.0.0.${i}`), params(`tok${i}`))).status).toBe(400);
      const mesmo = createUnsubscribeToken("lead-inexistente");
      let last: Response = await GET(req("GET"), params(mesmo));
      for (let i = 0; i < 10; i++) last = await GET(req("GET"), params(mesmo));
      expect(last.status).toBe(429);
      expect(Number(last.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await last.text()).toContain("Tente novamente");
      const lead = await mkLead({ sequenceStatus: "active" });
      const tok = createUnsubscribeToken(lead.id);
      expect((await POST(req("POST"), params(tok))).status).toBe(200);
      expect((await POST(req("POST"), params(tok))).status).toBe(200);
    } finally {
      process.env.TRUSTED_PROXY_IP_HEADER = saved;
      _resetUnsubscribeRateLimit();
    }
  });
});

describe("reserva atômica (sending)", () => {
  beforeAll(async () => {
    await prisma.emailAccount.update({ where: { id: acc1 }, data: { dailyLimit: 1000, isActive: true } });
  });
  it("duas chamadas concorrentes enviam UMA vez", async () => {
    const lead = await mkLead();
    const t = await mkTouch(lead.id);
    const sendMail = vi.fn(async () => ({ messageId: "<m1>" }));
    const transport = { sendMail } as never;
    const [a, b] = await Promise.all([sendEmail(t.id, { transport }), sendEmail(t.id, { transport })]);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect([a.status, b.status].sort()).toEqual(["already_sent", "sent"]);
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("sent");
  });

  it("falha SMTP e exceção inesperada saem de sending", async () => {
    const lead = await mkLead();
    const t = await mkTouch(lead.id);
    const r = await sendEmail(t.id, { transport: { sendMail: async () => { throw new Error("boom"); } } as never });
    expect(r.status).toBe("failed");
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("failed");
    const l2 = await mkLead();
    const t2 = await mkTouch(l2.id);
    const boom = await sendEmail(t2.id, { createTransport: () => { throw new Error("x"); } }).catch(() => null);
    expect(boom).toBeTruthy();
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: t2.id } })).status).not.toBe("sending");
  });

  it("crash simulado: sending recente bloqueia; >15 min é recuperável", async () => {
    const lead = await mkLead();
    const t = await mkTouch(lead.id, { status: "sending" });
    const sendMail = vi.fn(async () => ({ messageId: "<m2>" }));
    const transport = { sendMail } as never;
    expect((await sendEmail(t.id, { transport })).status).toBe("already_sent");
    expect(sendMail).not.toHaveBeenCalled();
    await prisma.touch.update({ where: { id: t.id }, data: { updatedAt: new Date(Date.now() - 16 * 60_000) } });
    expect((await sendEmail(t.id, { transport })).status).toBe("sent");
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});

describe("actions e queries de conta", () => {
  it("CRUD sem vazar senha; unique = erro de campo; validação PT-BR", async () => {
    const input = { provider: "smtp", smtpHost: "smtp.x.com", port: 587, email: `Novo@${TAG}.com`, password: PASS, dailyLimit: 10 };
    const c = await createEmailAccount(input);
    if (!c.ok) throw new Error(JSON.stringify(c.errors));
    const stored = await prisma.emailAccount.findUniqueOrThrow({ where: { id: c.data.id } });
    expect(stored.encryptedPassword).not.toContain(PASS);
    expect(stored.encryptedPassword.startsWith("v1:")).toBe(true);
    const dup = await createEmailAccount(input);
    expect(!dup.ok && dup.errors.email).toBeTruthy();
    const bad = await createEmailAccount({ ...input, email: "x", port: 70000, smtpHost: "", password: "" });
    expect(!bad.ok && Object.keys(bad.errors).sort()).toEqual(["email", "password", "port", "smtpHost"]);
    const list = await listEmailAccounts();
    expect(JSON.stringify(list)).not.toContain(PASS);
    expect(JSON.stringify(list)).not.toContain("encryptedPassword");
    expect(list.find((a) => a.id === c.data.id)?.hasPassword).toBe(true);
    const u = await updateEmailAccount({ ...input, id: c.data.id, password: "", dailyLimit: 20 });
    expect(u.ok).toBe(true);
    expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: c.data.id } })).encryptedPassword).toBe(stored.encryptedPassword);
    await updateEmailAccount({ ...input, id: c.data.id, password: "nova-senha" });
    expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: c.data.id } })).encryptedPassword).not.toBe(stored.encryptedPassword);
    expect((await getEmailAccount(c.data.id))?.dailyLimit).toBe(10);
    expect((await setActive({ id: c.data.id, isActive: false })).ok).toBe(true);
    expect((await deleteEmailAccount(c.data.id)).ok).toBe(true);
    expect((await deleteEmailAccount(c.data.id)).ok).toBe(false);
  });

  it("testEmailConnection: falha grava lastError sanitizado (host inalcançável, sem rede real)", async () => {
    await prisma.emailAccount.update({ where: { id: acc1 }, data: { smtpHost: "127.0.0.1", port: 1 } });
    const r = await testEmailConnection(acc1);
    expect(r.ok && r.data.ok).toBe(false);
    const a = await prisma.emailAccount.findUniqueOrThrow({ where: { id: acc1 } });
    expect(a.lastError).toBeTruthy();
    expect(a.lastError).not.toMatch(/127\.0\.0\.1/);
  });

  it("testEmailConnection: host interno é bloqueado por padrão (sem ALLOW_PRIVATE_SMTP_HOSTS)", async () => {
    await prisma.emailAccount.update({ where: { id: acc1 }, data: { smtpHost: "127.0.0.1", port: 1 } });
    process.env.ALLOW_PRIVATE_SMTP_HOSTS = "false";
    try {
      const r = await testEmailConnection(acc1);
      expect(r.ok && r.data.ok === false && r.data.message).toBe("Host não permitido: aponta para rede interna.");
    } finally {
      process.env.ALLOW_PRIVATE_SMTP_HOSTS = "true";
    }
  });

  it("exige sessão (requireUser)", async () => {
    signOut();
    expect((await createEmailAccount({})).ok).toBe(false);
    await expect(listEmailAccounts()).rejects.toThrow();
    expect((await testEmailConnection(acc1)).ok).toBe(false);
    await signInAsSeedAdmin();
  });
});

describe("header injection (CR/LF)", () => {
  async function build(over: { fromName?: string | null; leadEmail?: string; subject?: string; leadName?: string }) {
    if (over.fromName !== undefined) await prisma.emailAccount.update({ where: { id: acc1 }, data: { fromName: over.fromName, isActive: true } });
    if (over.subject !== undefined) await prisma.messageTemplate.update({ where: { id: tplId }, data: { subject: over.subject } });
    const lead = await mkLead({ ...(over.leadEmail ? { email: over.leadEmail } : {}), ...(over.leadName ? { name: over.leadName } : {}) });
    const t = await mkTouch(lead.id);
    const tr = json();
    let raw = "";
    vi.spyOn(tr, "sendMail").mockImplementationOnce((async (m: never) => {
      // streamTransport gera o MIME cru (jsonTransport não serializa cabeçalhos); inspecionamos as linhas de cabeçalho.
      const info = (await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(m)) as unknown as { message: Buffer };
      raw = info.message.toString("utf8");
      return { messageId: "<x>" } as never;
    }) as never);
    const r = await sendEmail(t.id, { transport: tr });
    return { r, headers: raw ? raw.split(/\r?\n\r?\n/)[0].split(/\r\n(?=\S)/) : null };
  }
  const noInjection = (headers: string[] | null) => {
    expect(headers).toBeTruthy();
    expect(headers!.filter((l) => /^(Bcc|Cc|X-Injected):/i.test(l))).toEqual([]);
  };

  it("subject renderizado com CRLF não injeta cabeçalho", async () => {
    const { headers } = await build({ subject: "Oi {{name}}", leadName: "Ana\r\nBcc: evil@x.com" });
    noInjection(headers);
    expect(headers!.some((l) => /^Subject:/i.test(l))).toBe(true);
    await prisma.messageTemplate.update({ where: { id: tplId }, data: { subject: "Oi {{firstName}}" } });
  });

  it("fromName com CRLF não injeta cabeçalho (schema rejeita; nodemailer neutraliza)", async () => {
    const schema = (await import("@/lib/schemas/email")).emailAccountCreateSchema;
    const base = { provider: "smtp", smtpHost: "smtp.x.com", port: 587, email: "a@x.com", password: "p" };
    for (const bad of ["Time\r\nBcc: e@x.com", "Time\nX", "Time\u2028X", "Time\u2029X"]) {
      expect(schema.safeParse({ ...base, fromName: bad }).success).toBe(false);
    }
    expect(schema.safeParse({ ...base, email: "a@x.com\r\nBcc: e@x.com" }).success).toBe(false);
    expect(schema.safeParse({ ...base, smtpHost: "smtp.x.com\r\nBcc" }).success).toBe(false);
    expect(schema.safeParse({ ...base, smtpHost: "smtp.x.com", fromName: "Time" }).success).toBe(true);
    // defesa em profundidade: mesmo se um fromName sujo já estiver no banco, o e-mail montado não ganha cabeçalho.
    const { headers } = await build({ fromName: "Time\r\nBcc: evil@x.com" });
    noInjection(headers);
    await prisma.emailAccount.update({ where: { id: acc1 }, data: { fromName: "Time Zz" } });
  });

  it("destinatário (lead.email) com CRLF não injeta cabeçalho", async () => {
    const { r, headers } = await build({ leadEmail: "v@x.com\r\nBcc: evil@x.com" });
    if (r.status === "sent") noInjection(headers);
    else expect(r.status).toBe("failed");
  });
});
