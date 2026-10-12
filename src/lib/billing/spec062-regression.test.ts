import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "m1" })) }));

import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { syncOrgStatuses } from "@/lib/billing/status-map";
import { sendBillingReminders } from "@/lib/billing/reminders";
import { createCheckoutSession } from "@/lib/actions/billing";
import { createCourtesyOrganization } from "@/lib/actions/admin/organizations";
import { loadAccountStage } from "@/lib/auth/account-stage";
import { findDeletionBlockers } from "@/lib/account-deletion/blockers";
import { buildLegacyTrialsReport, maskEmail, trialState } from "@/lib/billing/legacy-trials-report";
import { SEED_IDS } from "../../../prisma/seed";
import { runTick } from "@/lib/scheduler/run-tick";
import { parkOtherOrgs } from "@/lib/test-utils/park-other-orgs";

const DAY = 24 * 3600_000;
const orgs: TestOrg[] = [];
const extraUsers: string[] = [];
const extraOrgs: string[] = [];

async function starterId() {
  return (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } })).id;
}
async function legacyTrialOrg(tag: string, trialEndsAt: Date | null, now = new Date()): Promise<TestOrg> {
  const o = await createTestOrg(tag);
  orgs.push(o);
  await prisma.subscription.create({ data: { orgId: o.orgId, planId: await starterId(), status: "trialing", trialEndsAt } });
  void now;
  return o;
}

beforeEach(() => signOut());
afterAll(async () => {
  await prisma.emailDispatchLog.deleteMany({ where: { orgId: { in: [...orgs.map((o) => o.orgId), ...extraOrgs] } } });
  await prisma.billingReminderLog.deleteMany({ where: { orgId: { in: orgs.map((o) => o.orgId) } } });
  await prisma.webhookEvent.deleteMany({ where: { orgId: { in: orgs.map((o) => o.orgId) } } });
  await prisma.subscription.deleteMany({ where: { orgId: { in: [...orgs.map((o) => o.orgId), ...extraOrgs] } } });
  await prisma.membership.deleteMany({ where: { orgId: { in: extraOrgs } } });
  await prisma.platformAuditLog.deleteMany({ where: { orgId: { in: extraOrgs } } });
  await prisma.organization.deleteMany({ where: { id: { in: extraOrgs } } });
  await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
  for (const o of orgs) await purgeTestOrg(o);
});

describe("trial LEGADO (D-062-17, politica A)", () => {
  it("syncOrgStatuses (tick): trial vigente = active; vencido ou sem data = suspended com suspendedReason automatic; honra a data, sem estender", async () => {
    const now = new Date();
    const vigente = await legacyTrialOrg("062-tv", new Date(now.getTime() + 3 * DAY));
    const vencido = await legacyTrialOrg("062-tx", new Date(now.getTime() - 1000));
    const semData = await legacyTrialOrg("062-tn", null);
    await syncOrgStatuses(now);
    const st = async (o: TestOrg) => prisma.organization.findUniqueOrThrow({ where: { id: o.orgId }, select: { status: true, suspendedReason: true } });
    expect(await st(vigente)).toEqual({ status: "active", suspendedReason: null });
    expect(await st(vencido)).toEqual({ status: "suspended", suspendedReason: "automatic" });
    expect(await st(semData)).toEqual({ status: "suspended", suspendedReason: "automatic" });
    // a data nao foi alterada em nenhum caso
    expect((await prisma.subscription.findUniqueOrThrow({ where: { orgId: vigente.orgId } })).trialEndsAt!.getTime()).toBeCloseTo(now.getTime() + 3 * DAY, -3);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { orgId: semData.orgId } })).trialEndsAt).toBeNull();
  });

  it("trial vencendo passa a suspended quando o tempo passa (o tick recalcula)", async () => {
    const now = new Date();
    const o = await legacyTrialOrg("062-tt", new Date(now.getTime() + 1 * DAY));
    await syncOrgStatuses(now);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: o.orgId } })).status).toBe("active");
    await syncOrgStatuses(new Date(now.getTime() + 2 * DAY));
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: o.orgId } })).status).toBe("suspended");
  });

  it("org com trial vencido paga em Configuracoes > Assinatura (createCheckoutSession, org real, sem casca) e volta a active", async () => {
    const o = await legacyTrialOrg("062-tp", new Date(Date.now() - DAY));
    await syncOrgStatuses(new Date());
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: o.orgId } })).status).toBe("suspended");
    await signInAs(o.userId, { orgId: o.orgId, platformRole: "provider" });
    const r = await createCheckoutSession({ planKey: "starter", cadence: "monthly" });
    expect(r.ok).toBe(true);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: o.orgId }, include: { subscription: true } });
    expect(org.status).toBe("active");
    expect(org.subscription?.status).toBe("active");
    expect(org.setupPendingSince).toBeNull();
    expect(await prisma.organization.count({ where: { setupPendingSince: { not: null }, memberships: { some: { userId: o.userId } } } })).toBe(0);
  });

  it("lembrete trial_ending (3 dias antes) segue valendo para o legado", async () => {
    const now = new Date();
    const o = await legacyTrialOrg("062-te", new Date(now.getTime() + 2 * DAY));
    await sendBillingReminders(now);
    expect(await prisma.billingReminderLog.count({ where: { orgId: o.orgId, kind: "trial_ending" } })).toBe(1);
  });

  it("relatorio de trials legados: SOMENTE LEITURA, classifica vigente/vencido/sem_data e mascara o e-mail", async () => {
    const now = new Date();
    const v = await legacyTrialOrg("062-rv", new Date(now.getTime() + DAY));
    const x = await legacyTrialOrg("062-rx", new Date(now.getTime() - DAY));
    const n = await legacyTrialOrg("062-rn", null);
    const writes = vi.spyOn(prisma.subscription, "update");
    const before = await prisma.subscription.findMany({ where: { orgId: { in: [v.orgId, x.orgId, n.orgId] } }, orderBy: { orgId: "asc" } });
    const rep = await buildLegacyTrialsReport(prisma, now);
    const after = await prisma.subscription.findMany({ where: { orgId: { in: [v.orgId, x.orgId, n.orgId] } }, orderBy: { orgId: "asc" } });
    expect(after).toEqual(before); // nada alterado
    expect(writes).not.toHaveBeenCalled();
    const row = (o: TestOrg) => rep.trialing.find((t) => t.orgId === o.orgId)!;
    expect([row(v).state, row(x).state, row(n).state]).toEqual(["vigente", "vencido", "sem_data"]);
    expect(row(v).ownerEmail).toMatch(/^z\*\*\*@test\.local$/);
    expect(JSON.stringify(rep)).not.toMatch(/zz-062-rv-\d/);
    expect(rep.totals.trialing).toBeGreaterThanOrEqual(3);
    expect(rep.byStatus.find((b) => b.status === "trialing")?.count).toBe(rep.totals.trialing);
    expect(maskEmail("ana@x.com")).toBe("a***@x.com");
    expect(trialState(null, now)).toBe("sem_data");
    writes.mockRestore();
  });

  it("o script de relatorio nao contem escrita (sem update/delete/create/--apply)", () => {
    for (const f of ["src/scripts/legacy-trials-report.ts", "src/lib/billing/legacy-trials-report.ts"]) {
      const src = readFileSync(path.resolve(process.cwd(), f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
      expect(src, f).not.toMatch(/\.(update|updateMany|delete|deleteMany|create|createMany|upsert)\s*\(|\$executeRaw|--apply/);
    }
  });
});

describe("nenhum caminho cria trial (D-062-2/16)", () => {
  it("default de Subscription.status no banco e `incomplete` (nunca trialing por omissao)", async () => {
    const o = await createTestOrg("062-def");
    orgs.push(o);
    const sub = await prisma.subscription.create({ data: { orgId: o.orgId, planId: await starterId() } });
    expect(sub.status).toBe("incomplete");
  });

  const SRC = path.resolve(process.cwd(), "src");
  const walk = (d: string, out: string[] = []): string[] => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n)) out.push(p);
    }
    return out;
  };
  const files = [...walk(SRC), path.resolve(process.cwd(), "prisma/seed.ts")];

  it("teste estatico: nenhuma criacao de Subscription com status trialing, sem TRIAL_DAYS/trial-email/trial_started no codigo de producao", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const rel = path.relative(process.cwd(), f);
      expect(src, `${rel}: TRIAL_DAYS`).not.toMatch(/TRIAL_DAYS/);
      expect(src, `${rel}: trial-email`).not.toMatch(/trial-email|sendTrialStartedEmail|trialStartedTemplate/);
      expect(src, `${rel}: trial_started`).not.toMatch(/["']trial_started["']/);
      // criacao: `subscription.create/upsert(... status: "trialing" ...)` na mesma chamada
      for (const m of src.matchAll(/subscription\.(?:create|upsert)\(([\s\S]{0,400}?)\)\s*;/g)) {
        expect(m[1], `${rel}: cria Subscription trialing`).not.toMatch(/status:\s*["']trialing["']/);
      }
    }
  });

  it("migration 062a e ADITIVA: sem DROP/DELETE/UPDATE/TRUNCATE; so ADD COLUMN, SET DEFAULT e CREATE INDEX", () => {
    const dir = path.resolve(process.cwd(), "prisma/migrations");
    const m = readdirSync(dir).find((d) => d.endsWith("_cadastro_sem_trial"))!;
    const sql = readFileSync(path.join(dir, m, "migration.sql"), "utf8").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE)\b/i);
    expect(sql).toMatch(/ADD COLUMN "setupPendingSince" TIMESTAMP\(3\)/);
    expect(sql).toMatch(/ALTER COLUMN "status" SET DEFAULT 'incomplete'/);
    expect(sql).toMatch(/CREATE INDEX "Organization_setupPendingSince_idx"/);
  });
});

describe("cortesia, admin e seed inalterados (D-062 'Usuarios existentes')", () => {
  it("createCourtesyOrganization: org COMPLETA (sem casca, sem checkout), subscription active/courtesy, estado do dono = dono -> /dashboard", async () => {
    const admin = await prisma.user.create({ data: { id: randomUUID(), name: "zz adm 062", email: `zz-062-adm-${randomUUID().slice(0, 8)}@test.local`, role: "platform_admin" } });
    extraUsers.push(admin.id);
    await signInAs(admin.id, { orgId: null, platformRole: "platform_admin" });
    const email = `zz-062-court-${randomUUID().slice(0, 8)}@test.local`;
    const r = await createCourtesyOrganization({ name: "zz-062 cortesia", ownerEmail: email, ownerName: "Cortesia" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    extraUsers.push(r.data.userId);
    extraOrgs.push(r.data.orgId);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: r.data.orgId }, include: { subscription: { include: { plan: true } } } });
    expect(org.setupPendingSince).toBeNull();
    expect(org.status).toBe("active");
    expect(org.subscription).toMatchObject({ status: "active", externalSubscriptionId: null, externalCustomerId: null });
    expect(org.subscription?.plan.key).toBe("courtesy");
    expect(await loadAccountStage(r.data.userId, "provider")).toEqual({ stage: "dono", redirectTo: "/dashboard", pendingSetup: false });
    expect(await prisma.webhookEvent.count({ where: { orgId: r.data.orgId } })).toBe(0);
  });

  it("admin (platform_admin) segue indo a /admin/organizacoes; org do admin/seed sem casca e ativa", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@leadforge.local" } });
    expect((await loadAccountStage(admin.id, "platform_admin")).redirectTo).toBe("/admin/organizacoes");
    const seedOrg = await prisma.organization.findUniqueOrThrow({ where: { id: SEED_IDS.org }, include: { subscription: true } });
    expect(seedOrg.setupPendingSince).toBeNull();
    expect(seedOrg.subscription?.status).toBe("active");
  });
});

describe("exclusao de conta (054) com casca (D-062-21)", () => {
  it("casca PAGA e unico membro bloqueia com active_subscription; casca incomplete nao bloqueia", async () => {
    const u = await prisma.user.create({ data: { id: randomUUID(), name: "zz del 062", email: `zz-062-del-${randomUUID().slice(0, 8)}@test.local`, role: "provider", passwordHash: "x" } });
    extraUsers.push(u.id);
    const orgId = randomUUID();
    extraOrgs.push(orgId);
    await prisma.organization.create({ data: { id: orgId, name: "Organização em configuração", slug: `pendente-${orgId.slice(0, 8)}`, status: "suspended", setupPendingSince: new Date() } });
    await prisma.membership.create({ data: { userId: u.id, orgId, orgRole: "owner" } });
    await prisma.subscription.create({ data: { orgId, planId: await starterId(), status: "incomplete" } });
    expect((await findDeletionBlockers(prisma, u.id)).map((b) => b.code)).toEqual([]);
    await prisma.subscription.update({ where: { orgId }, data: { status: "active" } });
    expect((await findDeletionBlockers(prisma, u.id)).map((b) => b.code)).toEqual(["active_subscription"]);
  });
});

describe("tick completo com cascas no banco nao quebra", () => {
  beforeAll(() => undefined);
  it("runTick conclui sem erro mesmo com casca paga/abandonada presentes", async () => {
    const parked = await parkOtherOrgs();
    try {
      const orgId = randomUUID();
      extraOrgs.push(orgId);
      await prisma.organization.create({ data: { id: orgId, name: "x", slug: `pendente-${orgId.slice(0, 8)}`, status: "suspended", setupPendingSince: new Date(Date.now() - 30 * DAY) } });
      await prisma.subscription.create({ data: { orgId, planId: await starterId(), status: "incomplete" } });
      const s = await runTick(new Date(), { acquireLock: async () => ({ release: async () => {} }) as never });
      expect(s.status).toBe("ok");
      expect(await prisma.organization.count({ where: { id: orgId } })).toBe(0); // abandonada e apagada pelo tick
    } finally {
      await parked.restore();
    }
  });
});
