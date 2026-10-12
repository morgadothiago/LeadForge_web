import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "" })) }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { ensureTestPlan, mkCampaign, setOrgPlan, setTrial } from "@/lib/test-utils/trial-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { ForbiddenError, requireActiveProviderOrg, requireOrgOwner, requirePlatformAdmin, requireProviderOrg, requireProviderOrgAllowExpired, TrialExpiredError } from "./require-admin";
import { requireOrgMember } from "@/lib/org/guards";
import { redirectIfTrialExpired, requirePageProviderOrg } from "./require-page";
import { requireUser } from "./require-user";
import { createCheckoutSession } from "@/lib/actions/billing";
import { createCampaign } from "@/lib/actions/campaign";
import { createLead } from "@/lib/actions/lead";
import { listMyOrganizations, switchActiveOrganization, leaveOrganization } from "@/lib/actions/org";
import { listCampaigns } from "@/lib/queries/campaigns";
import { getBillingSummary, getOrgBannerState } from "@/lib/queries/billing";
import { syncOrgStatuses } from "@/lib/billing/status-map";
import { processInbound } from "@/lib/domain/whatsapp-inbound";
import { acceptInvite } from "@/lib/actions/org";
import { hashInviteToken } from "@/lib/org/tokens";

const ROOT = process.cwd();
const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const fnName = (chunk: string) => /^export (?:async )?function (\w+)/.exec(chunk)![1];
const exportedFns = (src: string) => src.split(/^(?=export (?:async )?function )/m).filter((c) => /^export (?:async )?function /.test(c));

describe("bloqueio total do trial expirado — varredura estatica (SPEC-065, D-065-13)", () => {
  const prod = walk(path.join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.includes("test-utils"));

  it("allowlist `AllowExpired` e EXATAMENTE a lista fechada (funcao a funcao); nenhum outro arquivo usa a variante", () => {
    const EXPECTED: Record<string, string[]> = {
      // checkout/portal/reativar (D-065-13.2). `cancelSubscription` NAO entra (QA 065a: cancelar devolveria leitura sem pagar).
      "src/lib/actions/billing.ts": ["createCheckoutSession", "createPortalSession", "reactivateSubscription"],
      "src/lib/actions/org.ts": ["leaveOrganization", "listMyOrganizations", "switchActiveOrganization"],
      "src/lib/queries/billing.ts": ["getBillingSummary", "getOrgBannerState", "getOrgStatusForBanner"],
      // SPEC-066a (spec 8.5): historico de mensalidades abre com a org suspensa/trial expirado (so leitura da PROPRIA org, sem dado de campanha/lead).
      "src/lib/queries/billing-history.ts": ["getBillingHistory"],
    };
    const found: Record<string, string[]> = {};
    for (const f of prod) {
      const r = rel(f);
      // definicoes dos guards (nao sao "chamadores")
      if (r === "src/lib/auth/require-admin.ts" || r === "src/lib/auth/require-page.ts" || r === "src/lib/org/guards.ts") continue;
      const src = readFileSync(f, "utf8");
      const fns = exportedFns(src).filter((c) => /requireProviderOrgAllowExpired\(\)|allowExpired:\s*true/.test(c.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n"))).map(fnName);
      if (fns.length) found[r] = fns.sort();
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(EXPECTED).map(([k, v]) => [k, [...v].sort()])));
  });

  it("requireProviderOrg e fail-closed por construcao: delega a AllowExpired e lanca TrialExpiredError; requireActiveProviderOrg/requireOrgMember/requireOrgOwner passam por ele", () => {
    const src = readFileSync(path.join(ROOT, "src/lib/auth/require-admin.ts"), "utf8");
    expect(src).toMatch(/export async function requireProviderOrg\(\)[\s\S]*?"trial_expirado"\) throw new TrialExpiredError/);
    expect(src).toMatch(/export async function requireActiveProviderOrg[\s\S]*?await requireProviderOrg\(\)/);
    const guards = readFileSync(path.join(ROOT, "src/lib/org/guards.ts"), "utf8");
    expect(guards).toMatch(/requireOrgMember[\s\S]*?allowExpired \? requireProviderOrgAllowExpired\(\) : requireProviderOrg\(\)/);
    expect(guards).toMatch(/requireOrgOwner[\s\S]*?await requireOrgMember\(\)/);
  });

  it("toda page.tsx de (app) fora da allowlist passa por guard que redireciona (redirectIfTrialExpired/requirePageProviderOrg)", () => {
    const ALLOW = new Set([
      "src/app/(app)/configuracoes/assinatura/page.tsx", // modo bloqueado (D-065-14)
      "src/app/(app)/configuracoes/conta/page.tsx", // Minha conta (requireProviderUser: sair/excluir)
      "src/app/(app)/organizacoes/page.tsx", // trocar de organizacao
      "src/app/(app)/configuracoes/page.tsx", // so redirect a /configuracoes/email (que e guardada)
    ]);
    const pages = walk(path.join(ROOT, "src/app/(app)")).filter((f) => f.endsWith("page.tsx") && !rel(f).startsWith("src/app/(app)/admin/"));
    expect(pages.length).toBeGreaterThan(20);
    for (const f of pages) {
      const r = rel(f);
      if (ALLOW.has(r)) continue;
      expect(readFileSync(f, "utf8"), `${r} sem guard de trial expirado`).toMatch(/await (?:redirectIfTrialExpired|requirePageProviderOrg)\(\)/);
    }
  });

  it("rotas de API por organizacao sem sessao: ingestao de leads recusa trial expirado; inbound/opt-out NAO passam pelo guard", () => {
    const ingest = readFileSync(path.join(ROOT, "src/lib/lead-ingest/handler.ts"), "utf8");
    expect(ingest).toMatch(/trial_expirado[\s\S]{0,300}err\(403, "trial_expired"/);
    const source = readFileSync(path.join(ROOT, "src/lib/lead-source/ingest.ts"), "utf8");
    expect(source).toMatch(/trial_expirado"\) return \{ status: "trial_expired" \}/);
    const inbound = readFileSync(path.join(ROOT, "src/lib/domain/whatsapp-inbound.ts"), "utf8");
    expect(inbound).not.toMatch(/trial_expirado|loadOrgAccess|TrialExpired/); // resposta de cliente e opt-out sempre honrados
  });
});

describe("bloqueio total — comportamento (orgs A trial ativo, B expirado, C pago; usuarios X/Y/Z, convidado W)", () => {
  let A: TestOrg, B: TestOrg, C: TestOrg;
  let W: string;
  let V: string; // membro de A e de B
  const orgs: TestOrg[] = [];
  const extraUsers: string[] = [];
  const mkUser = async (orgId: string, orgRole: "owner" | "member") => {
    const id = randomUUID();
    await prisma.user.create({ data: { id, name: "zz u", email: `zz-065-g-${id.slice(0, 8)}@test.local`, role: "provider" } });
    await prisma.membership.create({ data: { userId: id, orgId, orgRole } });
    extraUsers.push(id);
    return id;
  };
  const as = (userId: string, orgId: string) => signInAs(userId, { orgId, platformRole: "provider" });

  beforeAll(async () => {
    await ensureTestPlan("zz-guard", { maxCampaigns: 5, maxLeadsPerMonth: 100 });
    A = await createTestOrg("guard-a");
    B = await createTestOrg("guard-b");
    C = await createTestOrg("guard-c");
    orgs.push(A, B, C);
    await setTrial(A.orgId, "zz-guard");
    await setTrial(B.orgId, "zz-guard", true);
    await setOrgPlan(C.orgId, { planKey: "zz-guard", status: "active", trialEndsAt: null });
    W = await mkUser(B.orgId, "member"); // convidado em B
    V = await mkUser(A.orgId, "member");
    await prisma.membership.create({ data: { userId: V, orgId: B.orgId, orgRole: "member" } });
  });
  afterEach(() => signOut());
  afterAll(async () => {
    for (const o of orgs) await prisma.usageCounter.deleteMany({ where: { orgId: o.orgId } });
    await prisma.membership.deleteMany({ where: { userId: { in: extraUsers } } });
    await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
    for (const o of orgs) await purgeTestOrg(o);
  });

  it("requireProviderOrg: A e C passam; B lanca TrialExpiredError (subclasse de ForbiddenError); AllowExpired deixa B passar", async () => {
    await as(A.userId, A.orgId);
    await expect(requireProviderOrg()).resolves.toMatchObject({ orgId: A.orgId });
    await as(C.userId, C.orgId);
    await expect(requireProviderOrg()).resolves.toMatchObject({ orgId: C.orgId });
    await as(B.userId, B.orgId);
    const e = await requireProviderOrg().then(() => null, (x) => x);
    expect(e).toBeInstanceOf(TrialExpiredError);
    expect(e).toBeInstanceOf(ForbiddenError);
    await expect(requireProviderOrgAllowExpired()).resolves.toMatchObject({ orgId: B.orgId });
    for (const g of [requireActiveProviderOrg, requireOrgOwner, requireOrgMember]) await expect(g(), g.name).rejects.toBeInstanceOf(TrialExpiredError);
  });

  it("platform_admin segue recusado (ForbiddenError) e sem sessao segue UnauthorizedError", async () => {
    await signInAs(A.userId, { orgId: null, platformRole: "platform_admin" });
    await expect(requireProviderOrg()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requirePlatformAdmin()).resolves.toBeDefined();
    signOut();
    await expect(requireProviderOrg()).rejects.toMatchObject({ name: "UnauthorizedError" });
  });

  it("actions e queries por organizacao de B sao barradas (code trial_expired), mesmo abaixo da cota; A e C nao sao afetadas", async () => {
    await as(B.userId, B.orgId);
    const icpB = await (await import("@/lib/test-utils/trial-fixture")).mkIcp(B);
    const r = await createCampaign({ name: "x", icpId: icpB, status: "active" });
    expect(r).toMatchObject({ ok: false, errors: { code: ["trial_expired"] } });
    await expect(listCampaigns({})).rejects.toBeInstanceOf(TrialExpiredError);
    await as(A.userId, A.orgId);
    const icpA = await (await import("@/lib/test-utils/trial-fixture")).mkIcp(A);
    expect((await createCampaign({ name: "a", icpId: icpA, status: "active" })).ok).toBe(true);
    await as(C.userId, C.orgId);
    const icpC = await (await import("@/lib/test-utils/trial-fixture")).mkIcp(C);
    expect((await createCampaign({ name: "c", icpId: icpC, status: "active" })).ok).toBe(true);
    // lead em campanha de B continua barrado (acao direta, sem UI)
    const campB = await mkCampaign(B);
    await as(B.userId, B.orgId);
    expect(await createLead({ campaignId: campB, name: "x", email: "zz065-guard@example.com" })).toMatchObject({ ok: false, errors: { code: ["trial_expired"] } });
    expect(await prisma.lead.count({ where: { campaignId: campB } })).toBe(0);
  });

  it("allowlist funciona com B expirada: leitura da assinatura/banner, listar organizacoes; dono ve a assinatura, membro (convidado W) ve como nao-dono", async () => {
    await as(B.userId, B.orgId);
    expect(await getBillingSummary()).toMatchObject({ isOwner: true, subscription: { planKey: "zz-guard", status: "trialing" } });
    expect(await getOrgBannerState()).toMatchObject({ trialExpired: expect.anything() });
    const list = await listMyOrganizations();
    expect(list.ok && list.data.activeOrgId).toBe(B.orgId);
    await as(W, B.orgId);
    expect(await getBillingSummary()).toMatchObject({ isOwner: false });
    // convidado nao inicia checkout (nao-dono) e nao le dado da org
    expect(await createCheckoutSession({ planKey: "starter", cadence: "monthly" })).toMatchObject({ ok: false });
    expect(await createCampaign({ name: "w", icpId: randomUUID(), status: "active" })).toMatchObject({ ok: false, errors: { code: ["trial_expired"] } });
  });

  it("usuario com 2 orgs (A ativa + B expirada): na sessao de B lista, troca para A (reemite sessao) e passa a usar; sair de B tambem funciona", async () => {
    await as(V, B.orgId);
    await expect(requireProviderOrg()).rejects.toBeInstanceOf(TrialExpiredError);
    const sw = await switchActiveOrganization({ orgId: A.orgId });
    expect(sw.ok).toBe(true);
    await expect(requireProviderOrg()).resolves.toMatchObject({ orgId: A.orgId });
    await as(V, B.orgId);
    const left = await leaveOrganization();
    expect(left.ok).toBe(true);
    await prisma.membership.create({ data: { userId: V, orgId: B.orgId, orgRole: "member" } }); // restaura
  });

  it("paginas: org expirada => redirect a /configuracoes/assinatura (NEXT_REDIRECT); org ativa passa", async () => {
    await as(B.userId, B.orgId);
    for (const g of [redirectIfTrialExpired, requirePageProviderOrg]) {
      const e = (await g().then(() => null, (x) => x)) as { digest?: string } | null;
      expect(e?.digest ?? "", g.name).toMatch(/NEXT_REDIRECT.*\/configuracoes\/assinatura/);
    }
    await as(A.userId, A.orgId);
    await expect(redirectIfTrialExpired()).resolves.toBeUndefined();
    await expect(requirePageProviderOrg()).resolves.toMatchObject({ orgId: A.orgId });
    signOut();
    const e = (await redirectIfTrialExpired().then(() => null, (x) => x)) as { digest?: string } | null;
    expect(e?.digest).toMatch(/\/login/);
  });

  it("convite para a org EXPIRADA B e aceito (sem trial proprio, D-065-20): entra como membro e ve a mensagem de nao-dono; nada de org/assinatura nova", async () => {
    const k = randomUUID();
    const email = `zz-065-inv-${k.slice(0, 8)}@test.local`;
    await prisma.user.create({ data: { id: k, name: "k", email, role: "provider" } });
    extraUsers.push(k);
    await prisma.orgInvite.create({ data: { orgId: B.orgId, email, tokenHash: hashInviteToken(`tok-065-${k}`), expiresAt: new Date(Date.now() + 60_000) } });
    const orgsBefore = await prisma.organization.count();
    const subBefore = await prisma.subscription.findUniqueOrThrow({ where: { orgId: B.orgId }, select: { trialEndsAt: true, status: true } });
    await signInAs(k, { orgId: null, platformRole: "provider" });
    expect(await acceptInvite({ token: `tok-065-${k}` })).toMatchObject({ ok: true, data: { orgId: B.orgId } });
    expect(await prisma.organization.count()).toBe(orgsBefore);
    expect(await prisma.subscription.findUniqueOrThrow({ where: { orgId: B.orgId }, select: { trialEndsAt: true, status: true } })).toEqual(subBefore);
    expect(await prisma.subscription.count({ where: { org: { memberships: { some: { userId: k } } } } })).toBe(1);
    await expect(requireProviderOrg()).rejects.toBeInstanceOf(TrialExpiredError); // sessao ja na org B
    expect(await getBillingSummary()).toMatchObject({ isOwner: false });
  });

  it("pagar desbloqueia na hora (sem novo login): checkout do owner de B (mock) -> active, requireProviderOrg passa com a MESMA sessao; A/C inalteradas", async () => {
    const o = await createTestOrg("guard-pay");
    orgs.push(o);
    await setTrial(o.orgId, "zz-guard", true);
    await as(o.userId, o.orgId);
    await expect(requireProviderOrg()).rejects.toBeInstanceOf(TrialExpiredError);
    const r = await createCheckoutSession({ planKey: "starter", cadence: "monthly" });
    expect(r.ok).toBe(true);
    await expect(requireProviderOrg()).resolves.toMatchObject({ orgId: o.orgId });
    expect((await requireUser()).orgAccess).toBe("pago");
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: o.orgId }, select: { status: true, trialEndsAt: true, plan: { select: { key: true } } } });
    expect(sub).toMatchObject({ status: "active", trialEndsAt: null, plan: { key: "starter" } });
  });

  it("tick: syncOrgStatuses suspende B (automatic) e A/C seguem active; o scheduler so seleciona orgs `active`", async () => {
    await syncOrgStatuses(new Date());
    const st = async (id: string) => prisma.organization.findUniqueOrThrow({ where: { id }, select: { status: true, suspendedReason: true } });
    expect(await st(B.orgId)).toEqual({ status: "suspended", suspendedReason: "automatic" });
    expect((await st(A.orgId)).status).toBe("active");
    expect((await st(C.orgId)).status).toBe("active");
    const selected = (await prisma.organization.findMany({ where: { status: "active", id: { in: [A.orgId, B.orgId, C.orgId] } }, select: { id: true } })).map((o) => o.id);
    expect(selected.sort()).toEqual([A.orgId, C.orgId].sort());
  });

  it("inbound e opt-out de org EXPIRADA continuam honrados (gravados; sem envio/automacao)", async () => {
    const E = await createTestOrg("guard-inbound");
    orgs.push(E);
    await setTrial(E.orgId, "zz-guard", true);
    const camp = await mkCampaign(E);
    const phone = `+55119${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
    const inst = await prisma.whatsAppInstance.create({ data: { orgId: E.orgId, instanceName: `zz065in${Math.random().toString(36).slice(2, 8)}`, number: "+5511900000000", webhookToken: randomBytes(16).toString("hex") }, select: { id: true } });
    const lead = await prisma.lead.create({ data: { campaignId: camp, name: "Resp", phone, source: "manual", sequenceStatus: "active" }, select: { id: true } });
    await prisma.opportunity.create({ data: { leadId: lead.id, campaignId: camp, stage: "contactado" } });
    const now = new Date();
    const out = await prisma.$transaction((tx) => processInbound(tx, { id: inst.id, orgId: E.orgId }, { from: phone, text: "Oi, tenho interesse", externalId: `zz065-${randomUUID()}`, timestamp: now }, now));
    expect(out).toMatchObject({ status: "processed" });
    expect(await prisma.touch.count({ where: { leadId: lead.id, direction: "inbound" } })).toBe(1); // resposta gravada
    const out2 = await prisma.$transaction((tx) => processInbound(tx, { id: inst.id, orgId: E.orgId }, { from: phone, text: "PARAR", externalId: `zz065-${randomUUID()}`, timestamp: now }, now));
    expect(out2).toMatchObject({ status: "processed", kind: "opt_out" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).optedOutAt).not.toBeNull();
    expect(await prisma.touch.count({ where: { leadId: lead.id, direction: "outbound" } })).toBe(0);
  });
});
